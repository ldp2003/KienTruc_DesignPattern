const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const CircuitBreaker = require('circuit-breaker-js');
const { createProxyMiddleware } = require('http-proxy-middleware');
require('dotenv').config();

const app = express();

const limiter = rateLimit({
    windowMs: 1 * 5 * 1000,
    max: 15
});

const breaker = new CircuitBreaker({
    failureThreshold: 5,
    recoveryTimeout: 5000,
    timeout: 1000
});

const axiosRetry = require('axios-retry').default;
const axiosInstance = axios.create();
axiosRetry(axiosInstance, {
    retries: 5,
    retryDelay: (retryCount, error) => {
        const url = error.config.url;
        const serviceName = Object.entries(services).find(([name, serviceUrl]) =>
            url.includes(serviceUrl)
        )?.[0] || 'Unknown';

        console.log(`Retry ${serviceName} service - attempt ${retryCount}`);
        console.log('Waiting 3 seconds before next retry...');
        return 3000;
    },
    retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
            error.code === 'ECONNREFUSED';
    }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(limiter);

const createFaultTolerantProxy = (target, path) => {
    return createProxyMiddleware({
        target,
        changeOrigin: true,
        onProxyRes: async (proxyRes, req, res) => {
            if (proxyRes.statusCode >= 500) {

                if (!res.headersSent) {
                    res.status(500).json({
                        error: 'Service Error',
                        detail: 'Service failed to respond'
                    });
                }
            } else {
                proxyRes.pipe(res);
            }
        },
        onError: (err, req, res) => {
            if (!res.headersSent) {
                console.error(`Proxy Error for ${path}:`, err);
                res.status(500).json({ error: 'Service temporarily unavailable' });
            }
        }
    });
};

const services = {
    customers: process.env.CUSTOMER_SERVICE_URL || 'http://localhost:3001',
    products: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3000',
    orders: process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
    payments: process.env.PAYMENT_SERVICE_URL || 'http://localhost:3003',
    inventory: process.env.INVENTORY_SERVICE_URL || 'http://localhost:3004',
    shipping: process.env.SHIPPING_SERVICE_URL || 'http://localhost:3005'
};

Object.entries(services).forEach(([service, url]) => {
    app.use(`/api/${service}`, async (req, res, next) => {
        try {
            breaker.run(() => {
                const proxy = createFaultTolerantProxy(url, `/api/${service}`);
                return proxy(req, res, next);
            }, (err) => {
                console.error(`Circuit breaker opened for ${service}`);
                res.status(503).json({
                    error: 'Service temporarily unavailable, circuit is open'
                });
            });
        } catch (error) {
            console.error(`${service} service error:`, error.message);
            res.status(503).json({
                error: 'Service unavailable',
                detail: 'Service request failed'
            });
        }
    });
});

app.get('/health', async (req, res) => {
    try {
        console.log('\nChecking service health...');
        console.log('========================');

        const status = {
            gateway: 'OK'
        };

        const serviceChecks = Object.entries(services).map(async ([service, url]) => {
            try {
                status[service] = await checkServiceWithBreaker(url);
            } catch (error) {
                status[service] = 'Down';
                console.log(`${service} service is not available:`, error.message);
            }
        });

        await Promise.all(serviceChecks);

        console.log('\nService Status Summary:');
        console.log('========================');
        console.log('API Gateway: Running on port', PORT);
        Object.entries(status).forEach(([service, status]) => {
            const statusColor = status === 'OK' ? '\x1b[32m' : '\x1b[31m';
            console.log(`${service.padEnd(12)}: ${statusColor}${status}\x1b[0m`);
        });
        console.log('========================\n');

        res.json({ status });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ error: 'Health check failed' });
    }
});

async function checkServiceWithBreaker(url) {
    try {
        const response = await axiosInstance.get(`${url}/health`, {
            timeout: 15000,
            'axios-retry': {
                retryCount: 0
            }
        });
        const serviceName = Object.entries(services).find(([name, serviceUrl]) =>
            url.includes(serviceUrl)
        )?.[0] || 'Unknown';
        console.log(`${serviceName.padEnd(12)}: \x1b[32mRunning and Healthy\x1b[0m`);
        return 'OK';
    } catch (error) {
        const totalRetries = error.config?.['axios-retry']?.retryCount || 0;
        const serviceName = Object.entries(services).find(([name, serviceUrl]) =>
            url.includes(serviceUrl)
        )?.[0] || 'Unknown';

        if (error.code === 'ECONNREFUSED') {
            console.log(`${serviceName.padEnd(12)}: \x1b[31mNot Started (tried ${totalRetries} attempts)\x1b[0m`);
            return 'Not Started';
        }
        console.log(`${serviceName.padEnd(12)}: \x1b[31mDown (tried ${totalRetries} attempts)\x1b[0m`);
        return 'Down';
    }
}

const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
    console.log(`API Gateway running on port ${PORT}`);
    console.log('\nChecking service health...');
    console.log('========================');

    const serviceStatus = {};
    const serviceChecks = Object.entries(services).map(async ([name, url]) => {
        try {
            const status = await checkServiceWithBreaker(url);
            serviceStatus[name] = status;
        } catch (error) {
            serviceStatus[name] = 'Not Available';
        }
    });

    await Promise.all(serviceChecks);

    console.log('\nService Status Summary:');
    console.log('========================');
    console.log('API Gateway: Running on port', PORT);
    Object.entries(serviceStatus).forEach(([service, status]) => {
        const statusColor = status === 'OK' ? '\x1b[32m' : '\x1b[31m';
        console.log(`${service.padEnd(12)}: ${statusColor}${status}\x1b[0m`);
    });
    console.log('========================\n');
});