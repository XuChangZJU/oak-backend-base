import { initialize } from '../src/index';
import { Configuration } from '../src/types/Configuration';

const configuration: Configuration = {
    mysql: {
        host: 'localhost',
        user: 'root',
        database: 'obb',
        charset: 'utf8mb4_general_ci',
        connectionLimit: 20,
        password: '',
    },
}

initialize(`${__dirname}/../../bangzuxia`, configuration, true)
.then(
    () => console.log('success')
)
.catch(
    (err) => console.error(err)
);