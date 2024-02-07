"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const relationPath_1 = require("oak-domain/lib/utils/relationPath");
const console_1 = require("console");
const lodash_1 = require("oak-domain/lib/utils/lodash");
const OAK_SYNC_HEADER_ITEM = 'oak-sync-remote-id';
async function pushRequestOnChannel(channel, selfEncryptInfo) {
    const { queue, api } = channel;
    channel.queue = [];
    channel.lastPushTimestamp = Date.now();
    channel.handler = undefined;
    const opers = queue.map(ele => ele.oper);
    try {
        // todo 加密
        const res = await fetch(api, {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                [OAK_SYNC_HEADER_ITEM]: selfEncryptInfo.id,
            },
            body: JSON.stringify(opers),
        });
        if (res.status !== 200) {
            throw new Error(`访问api「${api}」的结果不是200。「${res.status}」`);
        }
        const json = await res.json();
        const { timestamp, error } = json;
        if (error) {
            throw new Error(`访问api「${api}」的结果出错，是${error}`);
        }
        if (!channel.remoteMaxTimestamp || channel.remoteMaxTimestamp < timestamp) {
            channel.remoteMaxTimestamp = timestamp;
        }
        queue.forEach((ele) => ele.resolve());
    }
    catch (err) {
        queue.forEach(({ reject }) => reject(err));
    }
}
class Synchronizer {
    config;
    schema;
    selfEncryptInfo;
    remotePullInfoMap = {};
    remotePushChannel = {};
    // 将产生的oper推送到远端Node。注意要尽量在本地阻止重复推送
    async pushOper(oper, userIds, getRemoteAccessInfo, endpoint) {
        await Promise.all(userIds.map(async (userId) => {
            if (!this.remotePushChannel[userId]) {
                const { url } = await getRemoteAccessInfo(userId);
                this.remotePushChannel[userId] = {
                    // todo 规范化
                    api: `${url}/endpoint/${endpoint || 'sync'}`,
                    queue: [],
                };
            }
            const channel = this.remotePushChannel[userId];
            if (channel.remoteMaxTimestamp && oper.bornAt < channel.remoteMaxTimestamp) {
                // 说明已经同步过了
                return;
            }
            const waiter = new Promise((resolve, reject) => {
                channel.queue.push({
                    oper,
                    resolve,
                    reject
                });
            });
            if (!channel.handler) {
                channel.handler = setTimeout(async () => {
                    (0, console_1.assert)(this.selfEncryptInfo);
                    await pushRequestOnChannel(channel, this.selfEncryptInfo);
                }, 1000); // 1秒钟集中同步一次
            }
            await waiter;
        }));
    }
    async loadPublicKey() {
        this.selfEncryptInfo = await this.config.self.getSelfEncryptInfo();
    }
    makeCreateOperTrigger() {
        const { config } = this;
        const { remotes, self } = config;
        // 根据remotes定义，建立从entity到需要同步的远端结点信息的Map
        const pushAccessMap = {};
        remotes.forEach((remote) => {
            const { getRemotePushInfo, syncEntities, endpoint } = remote;
            const pushEntityDefs = syncEntities.filter(ele => ele.direction === 'push');
            const pushEntities = pushEntityDefs.map(ele => ele.entity);
            pushEntities.forEach((entity) => {
                const def = syncEntities.find(ele => ele.entity === entity);
                const { path, relationName, recursive } = def;
                const { projection, getData } = relationName ? (0, relationPath_1.destructRelationPath)(this.schema, entity, path, {
                    relation: {
                        name: relationName,
                    }
                }, recursive) : (0, relationPath_1.destructDirectPath)(this.schema, entity, path, recursive);
                const getUserIds = (rows) => {
                    const urs = rows.map((row) => getData(row)).flat();
                    return (0, lodash_1.uniq)(urs.map(ele => ele.userId));
                };
                if (!pushAccessMap[entity]) {
                    pushAccessMap[entity] = [{
                            projection,
                            getUserIds,
                            getRemotePushInfo,
                            endpoint,
                        }];
                }
                else {
                    pushAccessMap[entity].push({
                        projection,
                        getUserIds,
                        getRemotePushInfo,
                        endpoint,
                    });
                }
            });
        });
        const pushEntities = Object.keys(pushAccessMap);
        // push相关联的entity，在发生操作时，需要将operation推送到远端
        const createOperTrigger = {
            name: 'push oper to remote node',
            entity: 'oper',
            action: 'create',
            when: 'commit',
            strict: 'makeSure',
            check: (operation) => {
                const { data } = operation;
                return pushEntities.includes(data.targetEntity);
            },
            fn: async ({ ids }, context) => {
                (0, console_1.assert)(ids.length === 1);
                const [oper] = await context.select('oper', {
                    data: {
                        id: 1,
                        action: 1,
                        data: 1,
                        targetEntity: 1,
                        operatorId: 1,
                        operEntity$oper: {
                            $entity: 'operEntity',
                            data: {
                                id: 1,
                                entity: 1,
                                entityId: 1,
                            },
                        },
                        $$createAt$$: 1,
                    },
                    filter: {
                        id: ids[0],
                    }
                }, { dontCollect: true });
                const { operatorId, targetEntity, operEntity$oper: operEntities } = oper;
                const entityIds = operEntities.map(ele => ele.entityId);
                const pushNodes = pushAccessMap[targetEntity];
                if (pushNodes) {
                    await Promise.all(pushNodes.map(async ({ projection, getUserIds, getRemotePushInfo: getRemoteAccessInfo, endpoint }) => {
                        const rows = await context.select(targetEntity, {
                            data: {
                                id: 1,
                                ...projection,
                            },
                            filter: {
                                id: {
                                    $in: entityIds,
                                },
                            },
                        }, { dontCollect: true });
                        // userId就是需要发送给远端的user，但是要将本次操作的user过滤掉（他是操作的产生者）
                        const userIds = getUserIds(rows).filter((ele) => ele !== operatorId);
                        if (userIds.length > 0) {
                            await this.pushOper(oper, userIds, getRemoteAccessInfo, endpoint);
                        }
                        return undefined;
                    }));
                    return entityIds.length * pushNodes.length;
                }
                return 0;
            }
        };
        return createOperTrigger;
    }
    constructor(config, schema) {
        this.config = config;
        this.schema = schema;
        this.loadPublicKey();
    }
    /**
     * 根据sync的定义，生成对应的 commit triggers
     * @returns
     */
    getSyncTriggers() {
        return [this.makeCreateOperTrigger()];
    }
    async checkOperationConsistent(entity, ids, bornAt) {
    }
    getSelfEndpoint() {
        return {
            name: this.config.self.endpoint || 'sync',
            method: 'post',
            params: ['entity'],
            fn: async (context, params, headers, req, body) => {
                // body中是传过来的oper数组信息
                const { entity } = params;
                const { [OAK_SYNC_HEADER_ITEM]: id } = headers;
                try {
                    // todo 这里先缓存，不考虑本身同步相关信息的更新
                    if (!this.remotePullInfoMap[entity]) {
                        this.remotePullInfoMap[entity] = {};
                    }
                    if (!this.remotePullInfoMap[entity][id]) {
                        const { getRemotePullInfo } = this.config.remotes.find(ele => ele.entity === entity);
                        this.remotePullInfoMap[entity][id] = await getRemotePullInfo(id);
                    }
                    const pullInfo = this.remotePullInfoMap[entity][id];
                    const { userId, algorithm, publicKey } = pullInfo;
                    // todo 解密
                    // 如果本次同步中有bornAt比本用户操作的最大的bornAt要小，则说明是重复更新，直接返回
                    const [maxHisOper] = await context.select('oper', {
                        data: {
                            id: 1,
                            bornAt: 1,
                        },
                        filter: {
                            operatorId: userId,
                        },
                        sorter: [
                            {
                                $attr: {
                                    bornAt: 1,
                                },
                                $direction: 'desc',
                            },
                        ],
                        indexFrom: 0,
                        count: 1,
                    }, { dontCollect: true });
                    const opers = body;
                    const legalOpers = maxHisOper ? opers.filter(ele => ele.bornAt > maxHisOper.bornAt) : opers;
                    if (legalOpers.length > 0) {
                        for (const oper of legalOpers) {
                            const { id, targetEntity, action, data, bornAt, operEntity$oper: operEntities } = oper;
                            const ids = operEntities.map(ele => ele.id);
                            this.checkOperationConsistent(targetEntity, ids, bornAt);
                            const operation = {
                                id,
                                data,
                                action,
                                filter: {
                                    id: {
                                        $in: ids,
                                    },
                                },
                                bornAt: bornAt,
                            };
                            await context.operate(targetEntity, operation, {});
                        }
                        // 因为legalOpers就是排好序的，所以直接返回最后一项的bornAt
                        return {
                            timestamp: legalOpers[legalOpers.length - 1].bornAt,
                        };
                    }
                    else {
                        (0, console_1.assert)(maxHisOper);
                        return {
                            timestamp: maxHisOper.bornAt,
                        };
                    }
                }
                catch (err) {
                    return {
                        error: JSON.stringify(err),
                    };
                }
            }
        };
    }
}
exports.default = Synchronizer;
