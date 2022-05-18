import { app, BrowserWindow, protocol } from 'electron'
import installExtension, { VUEJS_DEVTOOLS } from 'electron-devtools-installer'
import is from 'electron-is'
import express from 'express'
import type * as http from 'http'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { release } from 'os'
import { join } from 'path'

import { registerIpcMain } from './core/ipcMain'
import { createElectronMenu } from './core/menu'
import { createApiServer } from './core/neteaseapi/apiserver'
import { createTray } from './core/tray'
import WindowManager from './core/windowManager'

const log = require('electron-log')

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { secure: true, standard: true } }])
process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'

let appStaticServer: http.Server
let windowManager: WindowManager

start()

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

function start() {
  const gotTheLock = app.requestSingleInstanceLock()
  if (!gotTheLock) {
    return app.quit()
  } else {
    app.on('second-instance', () => {
      // 当运行第二个实例时,将会聚焦到前一个实例的窗口
      if (windowManager.window) {
        windowManager.window.show()
        if (windowManager.window.isMinimized()) windowManager.window.restore()
        windowManager.window.focus()
      }
    })
  }
  handleAppEvent()
}

function handleAppEvent() {
  // Quit when all windows are closed.
  app.on('window-all-closed', () => {
    // On macOS, it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    // On macOS, it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) windowManager.openWindow()
    else windowManager.window?.show()
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.on('ready', async () => {
    if (is.dev() && !process.env.IS_TEST) {
      // Install Vue Devtools
      try {
        await installExtension(VUEJS_DEVTOOLS)
      } catch (e) {
        console.error('Vue Devtools failed to install:', e)
      }
    }
    // Exit cleanly on request from parent process in development mode.
    if (is.dev()) {
      if (process.platform === 'win32') {
        process.on('message', (data) => {
          if (data === 'graceful-exit') {
            app.quit()
          }
        })
      } else {
        process.on('SIGTERM', () => {
          app.quit()
        })
      }
    }
    createApiServer()
    is.production() && createAppStaticServer()
    windowManager = new WindowManager()
    const window = await windowManager.openWindow()
    if (window) {
      createElectronMenu(window)
      is.windows() && createTray(window)
      registerIpcMain(window)
    }
  })
  app.on('quit', () => {
    appStaticServer && appStaticServer.close()
  })
  app.on('before-quit', () => {
    windowManager.willQuit = true
  })
}

// web静态资源express托管
function createAppStaticServer() {
  log.info('static app create')
  const app = express()
  const staticPath = join(__dirname, '../renderer')
  app.use('/', express.static(staticPath))
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://localhost:12138',
      changeOrigin: true,
      pathRewrite: (path) => path.replace(/^\/api/, ''),
    }) as express.RequestHandler
  )
  appStaticServer = app.listen(12137, '', () => {
    log.info('app run in port 12137')
  })
}

export const getWin = () => windowManager.window
