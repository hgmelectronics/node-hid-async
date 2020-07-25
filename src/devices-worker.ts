import { devices } from 'node-hid';

process.on('message', (message: { cmd: string }) => {
    if (message.cmd === 'devices') {
        try {
            const devs = devices();
            process.send({ cmd: 'devices', result: devs });
        }
        catch (err) {
            process.send({ cmd: 'devices', error: typeof err?.toString === 'function' ? err.toString() : err });
        }
    }
});
