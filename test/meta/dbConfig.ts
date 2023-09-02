import { MySQLConfiguration } from "oak-db/lib/MySQL/types/Configuration";

const config : MySQLConfiguration = {
    host: 'localhost',
    user: 'root',
    database: 'obb',
    charset: 'utf8mb4_general_ci',
    connectionLimit: 20,
    password: 'root',
};

export default config;