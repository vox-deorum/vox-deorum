# Overview

The TestEvent is a debugging and performance testing utility that triggers Lua hooks through the scripting system. This is a Lua hook rather than a standard GameEvent, specifically designed for testing the performance and functionality of the Lua event system in development and debugging scenarios.

# Event Triggers

This event is fired from `CvLuaGame::lSpewTestEvents()` when:

- The `SpewTestEvents` Lua function is called with a specified iteration limit
- Used for performance testing and debugging of the Lua event system
- The Lua script system is available and active
- Typically invoked from debug console or testing scripts

This is not a gameplay event but rather a development and debugging tool for measuring Lua event system performance.

# Parameters

The event provides four integer parameters, all set to `-1`:

1. **Test Parameter 1** (`-1`): Fixed test value for debugging purposes
2. **Test Parameter 2** (`-1`): Fixed test value for debugging purposes
3. **Test Parameter 3** (`-1`): Fixed test value for debugging purposes
4. **Test Parameter 4** (`-1`): Fixed test value for debugging purposes

# Event Details

The TestEvent system is designed for development and debugging purposes:

**Performance Testing:**

- Allows measurement of Lua hook call performance through `cvStopWatch` timing
- Can be run in batches with specified iteration counts for stress testing
- Measures both seconds and milliseconds for precise performance analysis
- Returns timing data back to the caller for performance evaluation

**Debug Functionality:**

- Provides a standardized way to test Lua event system connectivity
- Uses fixed parameter values to ensure consistent testing conditions
- Helps verify that the Lua scripting system is functioning correctly
- Can be used to identify performance bottlenecks in event processing

**Testing Workflow:**

1. Function receives an iteration limit parameter (default 1000)
2. Performance timer is started using `cvStopWatch`
3. Event is triggered the specified number of times
4. Each iteration calls the TestEvent Lua hook with fixed parameters
5. Timer results are returned as seconds, milliseconds, and total value

**Development Use Cases:**

- Benchmarking Lua event system performance
- Verifying scripting system functionality during development
- Stress testing event handling under load
- Debugging script connectivity issues

# Technical Details

**Source Location**: `CvLuaGame.cpp` line 3763  
**Hook Type**: Lua script hook (not GameEvent)  
**Triggering Function**: `lSpewTestEvents()`  
**Prerequisites**: Lua script system must be available

**Performance Measurement:** The function uses `cvStopWatch` to provide precise timing measurements:

- `StartPerfTest()`: Begins performance timing
- `GetDeltaInSeconds()`: Returns elapsed time for analysis
- Results are split into seconds and milliseconds components

**Return Values:** The testing function returns three values to Lua:

- Integer seconds elapsed
- Integer milliseconds elapsed (fractional portion)
- Integer value (used for additional test data)

**Script Integration:** While primarily a testing tool, TestEvent allows Lua scripts to:

- Implement custom performance testing logic
- Verify event system functionality
- Collect debugging information about event processing
- Integrate with automated testing frameworks

This event should not be relied upon for gameplay functionality as it is specifically designed for development, debugging, and performance testing scenarios.
