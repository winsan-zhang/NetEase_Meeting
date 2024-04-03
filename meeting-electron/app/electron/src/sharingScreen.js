const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');

const isLocal = process.env.MODE === 'local';
const isWin32 = process.platform === 'win32';

const MEETING_HEADER_HEIGHT = 28;
const NOTIFY_WINDOW_WIDTH = 408;
const NOTIFY_WINDOW_HEIGHT = 200;
const WINDOW_WIDTH = 1200;
const COLLAPSE_WINDOW_WIDTH = 350;

let mY = 0;

let excludeWindowList = [];

let memberNotifyTimer = null;

const sharingScreen = {
  isSharing: false,
  memberNotifyWindow: null,
};

const closeScreenSharingWindow = function () {
  ipcMain.removeAllListeners('nemeeting-sharing-screen');
  closeMemberNotifyWindow();
};

function createNotifyWindow(mainWindow) {
  if (
    sharingScreen.memberNotifyWindow &&
    !sharingScreen.memberNotifyWindow.isDestroyed()
  ) {
    return;
  }
  const nowDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = nowDisplay.workArea;
  sharingScreen.memberNotifyWindow = new BrowserWindow({
    width: NOTIFY_WINDOW_WIDTH,
    height: NOTIFY_WINDOW_HEIGHT,
    x: Math.round(width + NOTIFY_WINDOW_WIDTH),
    y: Math.round(height + NOTIFY_WINDOW_HEIGHT),
    titleBarStyle: 'hidden',
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    closable: false,
    resizable: false,
    skipTaskbar: true,
    transparent: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      preload: path.join(__dirname, './ipc.js'),
    },
  });
  const notifyWindow = sharingScreen.memberNotifyWindow;
  if (isLocal) {
    notifyWindow.loadURL('http://localhost:8000/#/memberNotify');
  } else {
    notifyWindow.loadFile(path.join(__dirname, '../build/index.html'), {
      hash: 'memberNotify',
    });
  }
  notifyWindow.setAlwaysOnTop(true, 'screen-saver');
  notifyWindow.show();
  setTimeout(() => {
    setNotifyWindowPosition(width, height);
  });
  if (isWin32) {
    ipcMain.on('member-notify-mousemove', () => {
      if (memberNotifyTimer) {
        clearNotifyWIndowTimeout();
      }
    });
  }
  ipcMain.on('notify-show', (event, arg) => {
    sharingScreen.memberNotifyWindow?.webContents.send('notify-show', arg);
    sharingScreen.memberNotifyWindow?.setPosition(
      Math.round(width - NOTIFY_WINDOW_WIDTH),
      Math.round(height - NOTIFY_WINDOW_HEIGHT),
    );
    if (isWin32) {
      clearNotifyWIndowTimeout();
      memberNotifyTimer = setTimeout(() => {
        setNotifyWindowPosition(width, height);
      }, 5000);
    }
  });

  ipcMain.on('notify-hide', (event, arg) => {
    sharingScreen.memberNotifyWindow?.webContents.send('notify-hide', arg);
    setNotifyWindowPosition(width, height);
  });
  ipcMain.on('member-notify-view-member-msg', (event, arg) => {
    mainWindow?.webContents.send('member-notify-view-member-msg');
  });
  ipcMain.on('member-notify-close', (event, arg) => {
    // mainWindow?.webContents.send('member-notify-close')
    setNotifyWindowPosition(width, height);
  });
  ipcMain.on('member-notify-not-notify', (event, arg) => {
    mainWindow?.webContents.send('member-notify-not-notify');
    setNotifyWindowPosition(width, height);
  });
  sharingScreen.memberNotifyWindow.on('destroyed', function (event) {
    removeMemberNotifyListener();
    sharingScreen.memberNotifyWindow = null;
  });
}
function setNotifyWindowPosition(width, height) {
  if (
    sharingScreen.memberNotifyWindow &&
    !sharingScreen.memberNotifyWindow.isDestroyed()
  ) {
    sharingScreen.memberNotifyWindow.setPosition(
      Math.round(width + NOTIFY_WINDOW_WIDTH),
      Math.round(height + NOTIFY_WINDOW_HEIGHT),
    );
  }
  clearNotifyWIndowTimeout();
}
function clearNotifyWIndowTimeout() {
  memberNotifyTimer && clearTimeout(memberNotifyTimer);
  memberNotifyTimer = null;
}
function removeMemberNotifyListener() {
  ipcMain.removeAllListeners('notify-show');
  ipcMain.removeAllListeners('notify-hide');
  ipcMain.removeAllListeners('member-notify-view-member-msg');
  ipcMain.removeAllListeners('member-notify-close');
  ipcMain.removeAllListeners('member-notify-not-notify');
  if (isWin32) {
    ipcMain.removeAllListeners('member-notify-mousemove');
  }
}

function closeMemberNotifyWindow() {
  sharingScreen.memberNotifyWindow?.destroy();
  sharingScreen.memberNotifyWindow = null;
  removeMemberNotifyListener();
  memberNotifyTimer && clearTimeout(memberNotifyTimer);
  memberNotifyTimer = null;
}

function addScreenSharingIpc({ mainWindow, initMainWindowSize }) {
  let shareScreen = null;
  // 用来改变工具栏视图的高度
  let mainHeight = [60];

  function removeMainHeight(height) {
    const index = mainHeight.findIndex((item) => item === height);
    if (index !== -1) {
      mainHeight.splice(index, 1);
    }
  }

  function setMainWindowHeight() {
    let height = Math.max.apply(null, mainHeight);
    // 如果高度没有超过 100 ， 说明是工具栏的高度，不需要改变主窗口的高度。 只有 40 ， 60  两种
    if (height < 100) {
      height = mainHeight[mainHeight.length - 1];
    }
    if (sharingScreen.isSharing) {
      mainWindow.setBounds({
        height,
      });
    }
    if (height === 60) {
      mainWindow.setBounds({
        width: WINDOW_WIDTH,
      });
    } else if (height === 40) {
      mainWindow.setBounds({
        width: COLLAPSE_WINDOW_WIDTH,
      });
    } else {
      mainWindow.setBounds({
        width: WINDOW_WIDTH,
      });
    }
    mainWindow.center();
    mainWindow.setBounds({
      y: mY,
    });
  }

  ipcMain.on('nemeeting-sharing-screen', (event, value) => {
    const { method, data } = value;
    const nowDisplay = shareScreen || screen.getPrimaryDisplay();
    const { x, y, width } = nowDisplay.workArea;
    switch (method) {
      case 'start':
        createNotifyWindow(mainWindow);
        mainWindow.setOpacity(0);
        mainWindow.setBackgroundColor('rgba(255, 255, 255,0)');
        setTimeout(() => {
          mainWindow.setOpacity(1);
          mainWindow.setBackgroundColor('rgba(255, 255, 255,0)');
        }, 600);
        sharingScreen.isSharing = true;

        mainWindow.setMinimizable(false);
        mainWindow.setMinimumSize(1, 1);
        mainWindow.setWindowButtonVisibility?.(false);
        mainWindow.setHasShadow(false);
        mainWindow.setResizable(false);

        const mainWidth = 760;
        const mainX = x + width / 2 - mainWidth / 2;
        // 记录主窗口的y坐标
        mY = y;

        mainWindow.setBounds({
          x: mainX,
          y,
          width: WINDOW_WIDTH,
        });

        mainWindow.setMovable(true);
        mainHeight = [60];
        setMainWindowHeight();

        mainWindow.setAlwaysOnTop(true, 'screen-saver');

        break;
      case 'share-screen':
        shareScreen = screen.getAllDisplays()[data];
        screen.on('display-removed', (_, data) => {
          const isSameDisplay = data.label === shareScreen?.label;
          if (isSameDisplay) {
            // TODO: 退出共享
          }
        });
        break;
      case 'stop':
        closeMemberNotifyWindow();
        if (sharingScreen.isSharing) {
          if (!data?.immediately) {
            mainWindow.setOpacity(0);
            setTimeout(() => {
              mainWindow.setOpacity(1);
              !isWin32 && mainWindow.setBackgroundColor('#ffffff');
            }, 600);
          }

          shareScreen = null;
          sharingScreen.isSharing = false;

          mainWindow.setMinimizable(true);
          mainWindow.setWindowButtonVisibility?.(true);
          mainWindow.setHasShadow(true);
          mainWindow.setAlwaysOnTop(false);
          mainWindow.setResizable(true);

          initMainWindowSize();
          mainWindow.show();

          sharingScreen.screenSharingChatRoomWindow?.hide();
        }
        break;
      case 'controlBarVisibleChangeByMouse':
        if (sharingScreen.isSharing) {
          if (data) {
            mainWindow.setBounds({
              width: WINDOW_WIDTH,
            });
            removeMainHeight(60);
            mainHeight.push(60);
            setMainWindowHeight(true);
          } else {
            mainWindow.setBounds({
              width: COLLAPSE_WINDOW_WIDTH,
            });
            removeMainHeight(40);
            mainHeight.push(40);
            setMainWindowHeight(true);
          }
          mainWindow.center();
          mainWindow.setBounds({
            y: mY,
          });
        }
        break;
      case 'openDeviceList':
        mainHeight.push(800);
        setMainWindowHeight();
        break;
      case 'closeDeviceList':
        removeMainHeight(800);
        setMainWindowHeight(true);
        break;
      case 'openPopover':
        mainHeight.push(150);
        setMainWindowHeight(true);
        break;
      case 'closePopover':
        removeMainHeight(150);
        setMainWindowHeight(true);
        break;
      case 'openModal':
        if (sharingScreen.isSharing) {
          mainHeight.push(300);
          setMainWindowHeight();
        }
        break;
      case 'closeModal':
        if (sharingScreen.isSharing) {
          removeMainHeight(300);
          setMainWindowHeight(true);
        }
        break;
      case 'openToast':
        if (sharingScreen.isSharing) {
          mainHeight.push(120);
          setMainWindowHeight();
        }
        event.sender.send('nemeeting-sharing-screen', {
          method,
          data: sharingScreen.isSharing,
        });
        break;
      case 'closeToast':
        if (sharingScreen.isSharing) {
          removeMainHeight(120);
          setMainWindowHeight(true);
        }
        break;
      case 'videoWindowHeightChange':
        const { height } = data;
        const videoWindow = BrowserWindow.fromWebContents(event.sender);
        if (videoWindow) {
          videoWindow?.setBounds({
            height: Math.round(height + MEETING_HEADER_HEIGHT),
          });
        }
        break;
      default:
        break;
    }
  });
}

module.exports = {
  sharingScreen,
  closeScreenSharingWindow,
  addScreenSharingIpc,
};
