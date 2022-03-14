import { NextApiRequest } from 'next';
import { NextApiResponseServerIO } from '../../utils';
import prisma from '../../utils/database';

export default async function handler(req: NextApiRequest, res: NextApiResponseServerIO) {
    const key = req.body.key;
    const value = req.body.value;

    if (!key || value === undefined) {
        res.status(400).send({ message: 'Key is undefined.' });
        return;
    }

    await prisma.config.update({ where: { key }, data: { value } });

    res.end();

    res.socket.server.io?.emit('configChange', key, value);
}