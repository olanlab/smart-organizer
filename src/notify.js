// Desktop notifications for watch mode, using what the system already has.

const { spawn } = require('child_process');

// The command that shows `message` as a notification, or null where there is none to use.
function notifyCommand(message, platform = process.platform) {
  if (platform === 'darwin') {
    const quoted = (text) => `"${text.replace(/["\\]/g, '\\$&')}"`;
    return ['osascript', ['-e', `display notification ${quoted(message)} with title ${quoted('Smart Organizer')}`]];
  }
  if (platform === 'linux') return ['notify-send', ['Smart Organizer', message]];
  return null;
}

// Shows a notification if the system can; failures are ignored, it is only a courtesy.
function notify(message) {
  const command = notifyCommand(message);
  if (!command) return;
  const child = spawn(command[0], command[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

module.exports = { notifyCommand, notify };
