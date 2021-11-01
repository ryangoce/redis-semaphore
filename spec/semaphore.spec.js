const compose = require('docker-compose');
const path = require('path');
const Redis = require('ioredis');

const sleep = function (timeout) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
};

describe('semaphore tests', () => {
    beforeAll(async () => {
        try {
            await compose.upAll({
                cwd: path.join(__dirname, './'),
                log: true
            });

            let isUp = false;
            let pollingCounter = 0;
            let pollingThreshold = 20;
            const retryIntervalInMs = 1000;
            const redisClient = new Redis(6379, 'localhost');
            while (pollingCounter < pollingThreshold) {
                try {
                    console.log('redisClient.status', redisClient.status);
                    if (redisClient.status == 'ready') {
                        isUp = true;
                        break;
                    } else {
                        await sleep(retryIntervalInMs);
                    }
                } catch (error) {
                    console.error(`error in redis. trying again in ${retryIntervalInMs}ms`, error);
                    await sleep(retryIntervalInMs);
                } finally {
                    pollingCounter++;
                }
            }

            if (isUp) {
                console.log('redis is up. continuing test');
            } else {
                console.error('redis did not start. stopping test');
            }
        } catch (error) {
            console.error('error in beforeAll', error);
            throw error;
        }

    }, 200000);

    afterAll(async () => {
        // TODO: need to sleep first. because socket hangs up when down is called immediately
        // NOTE: can comment this out so testing is faster
        await sleep(1000);
        await compose.down({
            cwd: path.join(__dirname, './'),
            log: true
        });
    }, 200000);

    it('should limit only 1 concurrent execute calls', async () => {
        const Semaphore = require('../index').Semaphore;
        const Redis = require('ioredis');

        const redisClient = new Redis(6379, 'localhost');

        const concurrency = 1;
        const numberOfTasksToDo = 3;
        const taskTimeToFinish = 1000;
        const semaphore = new Semaphore('abc', concurrency, function (type) {
            switch (type) {
                case 'client':
                    return redisClient;

                case 'bclient':
                    return new Redis(6379, 'localhost');

                default:
                    throw new Error('not known type');
            }
        });

        const doWork = async function() {
            const token = await semaphore.acquire();
            await sleep(taskTimeToFinish);
            await semaphore.release(token);
        }

        const start = Date.now();
        const tasks = [];

        for (let index = 0; index < numberOfTasksToDo; index++) {
            tasks.push(doWork());
        }

        await Promise.all(tasks);
        const duration = Date.now() - start;

        expect(duration).toBeLessThan((numberOfTasksToDo + 1) * taskTimeToFinish);
        expect(duration).toBeGreaterThanOrEqual((numberOfTasksToDo) * taskTimeToFinish);
    }, 6000)
});