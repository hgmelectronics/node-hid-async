Asynchronous [`node-hid`](https://github.com/node-hid/node-hid) wrapper
===============================

## Motivation

Many of `node-hid`'s calls are synchronous, which can be a problem for e.g. Electron applications. On Windows, `devices()` is the worst offender and can block for several *seconds*, but calls on devices themselves can also hang up the app. This is not `node-hid`'s fault but rather the OS's. To work around the problem, `node-hid-async` creates independent processes to run these calls.

## API

The API is a subset of [`node-hid`](https://github.com/node-hid/node-hid#complete-api)'s, using Promises and RxJS Observables as the asynchronous model. Most notably, `read`, `readSync`, and `readTimeout` are absent, since the behavior of `read` and `readTimeout` can be obtained using Observable operators.

### `NodeHidAsync`

Main manager/service class; usually there should be one instance per application. It immediately spawns a process for running `devices()`, and will spawn another process for every device you connect to. All these processes' life cycles are managed for you. It connects a handler to the `exit` event of the process you start it from, which when it fires will shut down all the child processes it started. You can also manually trigger this by calling `destroy()` (see below).

#### Constructor

> `NodeHidAsync()`
*   Creates an instance of the manager class.

#### Methods

> *`nodeHidAsync`*`.devices()`
*   Returns a Promise that resolves to an array of `Device`s (i.e. the same array that would be returned from a `devices()` call in `node-hid`).

> *`nodeHidAsync`*`.open(path)`
*   Returns a Promise that resolves to a `NodeHidAsyncDevice` connected to the device at the specified platform-specific path.

> *`nodeHidAsync`*`.open(vid, pid)`
*   Returns a Promise that resolves to a `NodeHidAsyncDevice` connected to the first device with the specified vendor and product ID.

> *`nodeHidAsync`*`.destroy()`
*   Immediately shuts down all processes associated with this instance of `NodeHidAsync` and releases resources.
*   Subsequently calling any method on the instance results in undefined behavior.

### `NodeHidAsyncDevice`

Represents a HID that has been opened for communication. Created by calling `open()` on the `NodeHidAsync` instance.

#### Methods

> *`device`*`.dataObs()`
*   Returns an Observable that emits received data packets. The Observable terminates when the device is closed.
*   The event payload is a Node `Buffer`. Note that on Windows the actual data will be prepended with a HID report number, as with unwrapped `node-hid`.

> *`device`*`.errorObs()`
*   Returns an Observable that emits errors. The Observable terminates when the device is closed.

> *`device`*`.write(data)`
*   Returns a Promise that resolves with the number of bytes actually written to the device.
*   `data` is an array of numbers or a Node `Buffer`. Note that on Windows this must be prepended with a HID report number (generally zero), as with unwrapped `node-hid`.

> *`device`*`.close()`
*   Returns a Promise that resolves when the device has been closed. Once the Promise has resolved, the device's worker process has been terminated.
*   Subsequently calling any method on the device results in undefined behavior.

> *`device`*`.pause()`
*   Same as `node-hid` `pause()`; appears this causes all packets to be dropped until a subsequent call to `resume()`.
*   Not tested.

> *`device`*`.resume()`
*   Same as `node-hid` `resume()`: restarts packet reception.
*   Note that, unlike `node-hid`, calling `dataObs()` does not automatically call this function.
*   Not tested.

> *`device`*`.sendFeatureReport(data)`
*   Returns a Promise that resolves with the number of bytes actually written to the device.
*   As with `node-hid`, the first byte must be a report ID.

> *`device`*`.getFeatureReport(id, length)`
*   Returns a Promise that resolves with a `Buffer` containing the data read.

## Notes

Any method that would be synchronous in `node-hid` necessarily blocks the associated I/O worker process; this means, for example, that a call to `devices()` will not begin executing until the promise returned from the previous call has resolved. The same applies to `write()`, `close()`, `sendFeatureReport()`, etc..

## Support

Please use the [github issues page](https://github.com/hgmelectronics/node-hid-async/issues) for any questions or issues. Any feedback is welcome, especially regarding architecture and/or API.
