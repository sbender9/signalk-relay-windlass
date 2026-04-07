# Test Suite for Signal K Relay Windlass Plugin

This directory contains comprehensive tests for the Signal K Relay Windlass plugin.

## Test Structure

### `windlass.test.ts` - Core Functionality Tests

- Plugin initialization and configuration
- Basic windlass control (up/down/off commands)
- PUT handler functionality
- Signal K message handling
- Safety timeout functionality
- Notification system
- Metadata registration

### `chain-counter.test.ts` - Chain Counter & Timing Tests

- Chain counter calculation accuracy
- Timing-sensitive functionality
- Continuous update behavior
- Direction switching delays
- Chain deployment/retrieval calculations

### `integration.test.ts` - Integration & Workflow Tests

- Complete anchoring workflows
- Error handling scenarios
- Plugin lifecycle management
- Real-world usage patterns

## Running Tests

### All Tests

```bash
npm test
```

### Specific Test Categories

```bash
# Core functionality tests
npm run test:unit

# Timing and chain counter tests
npm run test:timing

# Integration tests
npm run test:integration

# Watch mode for development
npm run test:watch
```

### Development Testing

```bash
# Run tests in watch mode during development
npm run test:watch

# Run with verbose output
npx mocha test/*.ts --reporter spec --require tsx
```

## Test Configuration

- **Timeout**: 5 seconds (configured in `.mocharc.json`)
- **Framework**: Mocha with Chai assertions
- **TypeScript**: Transpiled using `tsx`
- **Coverage**: Run `npm run ci-test` for full CI pipeline

## Mock Implementation

Tests use comprehensive mocks of the Signal K Server API that simulate:

- Message handling and subscriptions
- PUT handler registration
- Relay state management
- Timer functionality
- Real-world timing scenarios

## Key Testing Areas

1. **Safety Features**
   - Timeout protection with automatic shutoff
   - Direction switching delays
   - Safe state transitions

2. **Chain Counter Accuracy**
   - Time-based calculations
   - Rate conversion (feet per minute to meters)
   - Continuous updates during operation

3. **Signal K Integration**
   - Proper message formatting
   - Metadata registration
   - Subscription handling

4. **Error Handling**
   - Invalid commands
   - Missing configuration
   - Edge cases and recovery

## Test Data

Tests use realistic configuration values:

- Chain rate: 60 feet/minute (1 foot/second for easy calculation)
- Safety timeout: 30 seconds (reduced to 1 second in safety tests)
- Switching delay: 2 seconds (disabled in some tests for speed)

## Debugging Tests

For debugging specific test failures:

```bash
# Run single test file with detailed output
npx mocha test/windlass.test.ts --reporter spec --require tsx

# Run specific test pattern
npx mocha test/*.test.ts --grep "Chain Counter" --require tsx
```

All tests include detailed assertions and timing verification to ensure the plugin behaves correctly in production marine environments.
