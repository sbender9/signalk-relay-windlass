# SignalK Relay Windlass Plugin

A Signal K server plugin that provides safe control of an electric windlass (anchor winch) using two relay switches. This plugin allows you to raise and lower your anchor through Signal K while providing important safety features like automatic timeout protection.

## Features

- **Dual Relay Control**: Controls windlass up/down operation using separate relays
- **Safety Timeout**: Configurable automatic shutoff to prevent motor damage from extended operation
- **Real-time Status**: Live monitoring of windlass state based on relay feedback
- **Notification System**: Alert notifications when safety timeout is triggered
- **PUT Handler**: Control windlass through Signal K PUT requests

## Configuration

The plugin requires configuration of three main parameters:

### Settings

- **Windlass State Path**: Signal K path for windlass control state (default: `electrical.windlass.control.state`)
- **Up Relay Path**: Path to relay that controls windlass up operation (default: `electrical.windlass.up.state`)
- **Down Relay Path**: Path to relay that controls windlass down operation (default: `electrical.windlass.down.state`)
- **Safety Timeout**: Maximum continuous operation time in seconds (default: 30, range: 0-300, 0 = disabled)
- **Direction Switch Delay**: Minimum delay when switching between up and down directions in seconds (default: 2, range: 0-30, 0 = disabled)

## Usage

### Control Methods

The windlass can be controlled through several methods:

1. **Signal K Web Interface**: Use the controls in the web interface
2. **PUT Requests**: Send HTTP PUT requests to the windlass path
3. **WebSocket**: Send delta messages via WebSocket
4. **Node-RED**: Use Signal K nodes in Node-RED flows

### Control Values

- `"up"` - Raise the anchor (activates up relay, deactivates down relay)
- `"down"` - Lower the anchor (activates down relay, deactivates up relay)
- `"off"` - Stop operation (deactivates both relays)

### PUT Request Example

```bash
curl -X PUT \
  http://localhost:3000/signalk/v1/api/vessels/self/electrical/windlass/control/state \
  -H 'Content-Type: application/json' \
  -d '{"value": "up"}'
```

## Safety Features

### Automatic Timeout Protection

The plugin includes configurable timeout protection to prevent windlass motor damage:

- **Configurable Duration**: Set maximum run time (0-300 seconds)
- **Automatic Shutoff**: Both relays automatically deactivated when timeout reached
- **Visual/Audio Alerts**: Notifications sent through Signal K alert system
- **Debug Logging**: Timeout events logged for troubleshooting

### Direction Switch Delay Protection

To prevent motor and gearbox damage from rapid direction changes:

- **Configurable Delay**: Set minimum time between opposite direction commands (0-30 seconds)
- **Smart Timing**: Only applies when switching from up→down or down→up
- **Immediate Stop**: Off commands execute immediately for safety
- **Queue Management**: Direction changes are delayed and automatically executed when safe

### State Monitoring

- **Real-time Feedback**: Windlass state automatically updates based on relay positions
- **Conflict Detection**: System detects invalid relay combinations
- **Subscription-based**: Uses Signal K subscriptions for efficient monitoring

## Signal K Paths

### Output Paths

| Path                                | Description            | Values                    |
| ----------------------------------- | ---------------------- | ------------------------- |
| `electrical.windlass.control.state` | Current windlass state | `"up"`, `"down"`, `"off"` |

### Input Paths (Monitored)

| Path                             | Description      | Values                      |
| -------------------------------- | ---------------- | --------------------------- |
| `electrical.windlass.up.state`   | Up relay state   | `true` (on) / `false` (off) |
| `electrical.windlass.down.state` | Down relay state | `true` (on) / `false` (off) |

### Notification Paths

| Path                             | Description                 |
| -------------------------------- | --------------------------- |
| `notifications.windlass.timeout` | Timeout alert notifications |

## License

Licensed under the Apache License 2.0. See LICENSE file for details.

## Contributing

Issues and pull requests welcome! Please ensure:

- Code follows existing style (run `npm run format`)
- Tests pass (`npm test`)
- Documentation is updated for new features

## Author

Scott Bender <scott@scottbender.net>
