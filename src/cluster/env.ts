import { ClusterInfo } from 'oak-domain/lib/types/Cluster';

function getProcessEnvOption(option: string) {
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

// 初始化判定集群状态，目前支持pm2的集群信息
function initialize() {
    const pmId = getProcessEnvOption('NODE_APP_INSTANCE');
    if (pmId) {
        const usingCluster = true;
        const instanceId = parseInt(pmId);
        const instanceCount = parseInt(getProcessEnvOption('instances')!);
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
export function getClusterInfo(): ClusterInfo {
    return MyClusterInfo;
}