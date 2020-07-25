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

        this.worker = ChildProcess.fork(Path.join(__dirname, 'io-worker.js'));
        this.worker.on('message', this.onMessage);
    }

    private worker: ChildProcess.ChildProcess;
    private dispatcher = new EventEmitter();
    private dataSubject = new Subject<Buffer>();
    private errorSubject = new Subject<any>();

    openPath(path: string): Promise<void> {
        return this.sendCommand({ cmd: 'openPath', data: path });
    }

    openId(vid: number, pid: number): Promise<void> {
        return this.sendCommand({ cmd: 'openId', data: { vid: vid, pid: pid } });
    }

    dataObs() {
        return this.dataSubject.asObservable();
    }

    errorObs() {
        return this.errorSubject.asObservable();
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
            .then(data => Buffer.from(data));
    }

    destroy = () => {
        if (this.worker) {
            this.worker.removeAllListeners();
            this.worker.kill();
        }
        this.dispatcher.removeAllListeners();
        this.dataSubject.complete();
        this.errorSubject.complete();
        process.removeListener('exit', this.destroy);
    }

    private onMessage = (msg: any) => {
        if (msg.type === 'eventData') {
            this.dataSubject.next(Buffer.from(msg.data));
        }
        else if (msg.type === 'eventError') {
            this.errorSubject.next(msg.data);
        }
        else {
            this.dispatcher.emit(msg.cmd, { type: msg.type, data: msg.data });
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
            this.dispatcher.once(msg.cmd, handler);
            this.worker.send(msg, (err: Error) => {
                if (err) {
                    reject(err);
                    this.dispatcher.removeListener(msg.cmd, handler);
                }
            });
        });
    }
}

export class NodeHidAsync {
    constructor() {
        this.deviceWorker = ChildProcess.fork(Path.join(__dirname, 'devices-worker.js'));
        Process.on('exit', this.doDestroy);
    }

    private deviceWorker: ChildProcess.ChildProcess;
    private ioDevices = new Set<NodeHidAsyncIo>();

    devices(): Promise<Device[]> {
        return new Promise((resolve, reject) => {
            this.deviceWorker.once('message', (message: { cmd: 'devices', result?: Device[], error?: any }) => {
                if (message.cmd === 'devices') {
                    if (message.error) {
                        reject(message.error);
                    }
                    else {
                        resolve(message.result);
                    }
                }
            });
            this.deviceWorker.send({ cmd: 'devices' }, (err: Error) => {
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
                this.ioDevices.add(device);
                device.errorObs().toPromise().then(() => this.ioDevices.delete(device));    // when error observable terminates, the device has been destroyed
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
        if (this.deviceWorker) {
            this.deviceWorker.removeAllListeners();
            this.deviceWorker.kill();
        }
        this.ioDevices.forEach(device => device.destroy());
        Process.removeListener('exit', this.doDestroy);
    }
}
