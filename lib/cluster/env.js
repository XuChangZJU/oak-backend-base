"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getClusterInfo = void 0;
function getProcessEnvOption(option) {
    if (process.env.hasOwnProperty(option)) {
        return process.env[option];
    }
    const lowerCase = option.toLowerCase();
    if (process.env.hasOwnProperty(lowerCase)) {
        return process.env[lowerCase];
    }
    const upperCase = option.toUpperCase();
    if (process.env.hasOwnProperty(upperCase)) {
        return process.env[upperCase];
    }
}
// 初始化判定集群状态，需要在环境变量中注入两个值
/** pm2注入方法，见：https://pm2.fenxianglu.cn/docs/general/environment-variables
 * apps: [
        {
            name: 'xxx',
            script: "xxxjs",
            instances: "2",
            increment_var: "OAK_INSTANCE_ID",
            env: {
                OAK_INSTANCE_CNT: 9,
                OAK_INSTANCE_ID: 8,
            }
        },
    ],
**/
function initialize() {
    const instanceIdStr = getProcessEnvOption('OAK_INSTANCE_ID');
    if (instanceIdStr) {
        const usingCluster = true;
        const instanceId = parseInt(instanceIdStr);
        const instanceCount = parseInt(getProcessEnvOption('OAK_INSTANCE_CNT'));
        return {
            usingCluster,
            instanceCount,
            instanceId,
        };
    }
    return {
        usingCluster: false,
    };
}
const MyClusterInfo = initialize();
/**
 * 得到当前环境的集群信息
 */
function getClusterInfo() {
    return MyClusterInfo;
}
exports.getClusterInfo = getClusterInfo;
