import * as ChildProcess from 'child_process';
import { EventEmitter } from 'events';
import { Device } from 'node-hid';
import * as Path from 'path';
import * as Process from 'process';
import { Observable, Subject } from 'rxjs';

export interface NodeHidAsyncDevice {
    dataObs(): Observable<Buffer>;
    errorObs(): Observable<any>;
    write(values: number[] | Buffer): Promise<number>;
    close(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    sendFeatureReport(data: number[] | Buffer): Promise<number>;
    getFeatureReport(id: number, length: number): Promise<Buffer>;
}

class NodeHidAsyncIo implements NodeHidAsyncDevice {
    constructor() {
        Process.on('exit', this.destroy);

        this.mWorker = ChildProcess.fork(Path.join(__dirname, 'io-worker.js'));
        this.mWorker.on('message', this.onMessage);
    }

    private mWorker: ChildProcess.ChildProcess;
    private mDispatcher = new EventEmitter();
    private mDataSubject = new Subject<Buffer>();
    private mErrorSubject = new Subject<any>();

    openPath(path: string): Promise<void> {
        return this.sendCommand({ cmd: 'openPath', data: path });
    }

    openId(vid: number, pid: number): Promise<void> {
        return this.sendCommand({ cmd: 'openId', data: { vid: vid, pid: pid } });
    }

    dataObs() {
        return this.mDataSubject.asObservable();
    }

    errorObs() {
        return this.mErrorSubject.asObservable();
    }

    write(values: number[] | Buffer): Promise<number> {
        return this.sendCommand({ cmd: 'write', data: (values instanceof Buffer) ? new Array(values) : values });
    }

    close(): Promise<void> {
        return this.sendCommand({ cmd: 'close' })
            .then(() => this.destroy())
            .catch(err => {
                this.destroy();
                throw err;
            });
    }

    pause(): Promise<void> {
        return this.sendCommand({ cmd: 'pause' });
    }

    resume(): Promise<void> {
        return this.sendCommand({ cmd: 'resume' });
    }

    sendFeatureReport(data: number[] | Buffer): Promise<number> {
        return this.sendCommand({ cmd: 'sendFeatureReport', data: (data instanceof Buffer) ? new Array(data) : data });
    }

    getFeatureReport(id: number, length: number): Promise<Buffer> {
        return this.sendCommand({ cmd: 'getFeatureReport', data: { id: id, length: length } })
            .then(data => new Buffer(data));
    }

    destroy = () => {
        if (this.mWorker) {
            this.mWorker.removeAllListeners();
            this.mWorker.kill();
        }
        this.mDispatcher.removeAllListeners();
        this.mDataSubject.complete();
        this.mErrorSubject.complete();
        process.removeListener('exit', this.destroy);
    }

    private onMessage = (msg: any) => {
        if (msg.type === 'eventData') {
            this.mDataSubject.next(new Buffer(msg.data));
        }
        else if (msg.type === 'eventError') {
            this.mErrorSubject.next(msg.data);
        }
        else {
            this.mDispatcher.emit(msg.cmd, { type: msg.type, data: msg.data });
        }
    }

    private sendCommand(msg: { cmd: string, data?: any }): Promise<any> {
        return new Promise((resolve, reject) => {
            const handler = (arg: { type: 'done' | 'error', data: any }) => {
                if (arg.type === 'done') {
                    resolve(arg.data);
                }
                else {
                    reject(arg.data);
                }
            };
            this.mDispatcher.once(msg.cmd, handler);
            this.mWorker.send(msg, (err: Error) => {
                if (err) {
                    reject(err);
                    this.mDispatcher.removeListener(msg.cmd, handler);
                }
            });
        });
    }
}

export class NodeHidAsync {
    constructor() {
        this.mDeviceWorker = ChildProcess.fork(Path.join(__dirname, 'devices-worker.js'));
        Process.on('exit', this.doDestroy);
    }

    private mDeviceWorker: ChildProcess.ChildProcess;
    private mIoDevices = new Set<NodeHidAsyncIo>();

    devices(): Promise<Device[]> {
        return new Promise((resolve, reject) => {
            this.mDeviceWorker.once('message', (message: { cmd: 'devices', result?: Device[], error?: any }) => {
                if (message.cmd === 'devices') {
                    if (message.error) {
                        reject(message.error);
                    }
                    else {
                        resolve(message.result);
                    }
                }
            });
            this.mDeviceWorker.send({ cmd: 'devices' }, (err: Error) => {
                if (err) {
                    reject(err);
                }
            });
        });
    }

    open(path: string): Promise<NodeHidAsyncDevice>;
    open(vid: number, pid: number): Promise<NodeHidAsyncDevice>;
    open(first: string | number, pid?: number): Promise<NodeHidAsyncDevice> {
        let device: NodeHidAsyncIo;
        try {
            device = new NodeHidAsyncIo();
        }
        catch (err) {
            return Promise.reject(err);
        }
        const openPromise = (typeof first === 'number') ? device.openId(first, pid) : device.openPath(first);
        return openPromise
            .then(() => {
                this.mIoDevices.add(device);
                device.errorObs().toPromise().then(() => this.mIoDevices.delete(device));    // when error observable terminates, the device has been destroyed
                return device;
            })
            .catch(err => {
                device.destroy();
                throw err;
            });
    }

    destroy() {
        this.doDestroy();
    }

    private doDestroy = () => {
        if (this.mDeviceWorker) {
            this.mDeviceWorker.removeAllListeners();
            this.mDeviceWorker.kill();
        }
        this.mIoDevices.forEach(device => device.destroy());
        Process.removeListener('exit', this.doDestroy);
    }
}
