import { HID } from 'node-hid';

let dev: HID;

function hookEvents() {
    dev.on('data', values => {
        process.send({ type: 'eventData', data: Array.from(values) })
    });
    dev.on('error', err => {
        process.send({ type: 'eventError', data: err});
    });
}

const handlers = {
    openPath: (path: string) => {
        if (dev) {
            throw new Error('A device is already open');
        }
        dev = new HID(path);
        hookEvents();
    },
    openId: (id: { vid: number, pid: number }) => {
        if (dev) {
            throw new Error('A device is already open');
        }
        dev = new HID(id.vid, id.pid);
        hookEvents();
    },
    write: (values: number[]) => {
        if (!dev) {
            throw new Error('Device is not open');
        }
        return dev.write(values);
    },
    close: () => {
        if (!dev) {
            throw new Error('Device is not open');
        }
        return dev.close();
    },
    pause: () => {
        if (!dev) {
            throw new Error('Device is not open');
        }
        return dev.pause();
    },
    resume: () => {
        if (!dev) {
            throw new Error('Device is not open');
        }
        return dev.resume();
    },
    sendFeatureReport: (data: number[]) => {
        if (!dev) {
            throw new Error('Device is not open');
        }
        return dev.sendFeatureReport(data);
    },
    getFeatureReport: (data: { id: number, length: number }) => {
        if (!dev) {
            throw new Error('Device is not open');
        }
        return dev.getFeatureReport(data.id, data.length);
    }
};

process.on('message', (msg: { cmd: string, data?: any }) => {
    const handler = handlers[msg.cmd];
    if (handler) {
        let result: any;
        try {
            result = handler(msg.data);
        }
        catch (err) {
            process.send({ cmd: msg.cmd, type: 'error', data: err });
            return;
        }
        process.send({ cmd: msg.cmd, type: 'done', data: result });
    }
});
