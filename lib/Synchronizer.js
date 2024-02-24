"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const relationPath_1 = require("oak-domain/lib/utils/relationPath");
const assert_1 = tslib_1.__importDefault(require("assert"));
const path_1 = require("path");
const filter_1 = require("oak-domain/lib/store/filter");
const OAK_SYNC_HEADER_ITEM = 'oak-sync-remote-id';
async function pushRequestOnChannel(channel, selfEncryptInfo) {
    const { queue, api } = channel;
    channel.queue = [];
    channel.lastPushTimestamp = Date.now();
    channel.handler = undefined;
    const opers = queue.map(ele => ele.oper);
    try {
        // todo 加密
        console.log('向远端结点sync数据', api, JSON.stringify(opers));
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
    async pushOper(oper, userId, url, endpoint) {
        if (!this.remotePushChannel[userId]) {
            this.remotePushChannel[userId] = {
                // todo 规范化
                api: (0, path_1.join)(url, 'endpoint', endpoint),
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
                (0, assert_1.default)(this.selfEncryptInfo);
                await pushRequestOnChannel(channel, this.selfEncryptInfo);
            }, 1000); // 1秒钟集中同步一次
        }
        await waiter;
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
            const { getRemotePushInfo, pushEntities: pushEntityDefs, endpoint, pathToUser, relationName: rnRemote, entitySelf } = remote;
            if (pushEntityDefs) {
                const pushEntities = [];
                const endpoint2 = (0, path_1.join)(endpoint || 'sync', entitySelf || self.entitySelf);
                for (const def of pushEntityDefs) {
                    const { path, relationName, recursive, entity, actions, onSynchronized } = def;
                    pushEntities.push(entity);
                    const relationName2 = relationName || rnRemote;
                    const path2 = pathToUser ? `${path}.${pathToUser}` : path;
                    const { projection, getData } = relationName2 ? (0, relationPath_1.destructRelationPath)(this.schema, entity, path2, {
                        relation: {
                            name: relationName,
                        }
                    }, recursive) : (0, relationPath_1.destructDirectPath)(this.schema, entity, path2, recursive);
                    const groupByUsers = (rows) => {
                        const userRowDict = {};
                        rows.filter((row) => {
                            const userIds = getData(row)?.map(ele => ele.userId);
                            if (userIds) {
                                userIds.forEach((userId) => {
                                    if (userRowDict[userId]) {
                                        userRowDict[userId].push(row.id);
                                    }
                                    else {
                                        userRowDict[userId] = [row.id];
                                    }
                                });
                            }
                        });
                        return userRowDict;
                    };
                    if (!pushAccessMap[entity]) {
                        pushAccessMap[entity] = [{
                                projection,
                                groupByUsers,
                                getRemotePushInfo,
                                endpoint: endpoint2,
                                entity,
                                actions,
                                onSynchronized
                            }];
                    }
                    else {
                        pushAccessMap[entity].push({
                            projection,
                            groupByUsers,
                            getRemotePushInfo,
                            endpoint: endpoint2,
                            entity,
                            actions,
                            onSynchronized
                        });
                    }
                }
            }
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
                (0, assert_1.default)(ids.length === 1);
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
                        bornAt: 1,
                        $$createAt$$: 1,
                    },
                    filter: {
                        id: ids[0],
                    }
                }, { dontCollect: true });
                const { operatorId, targetEntity, operEntity$oper: operEntities, action, data } = oper;
                const entityIds = operEntities.map(ele => ele.entityId);
                const pushEntityNodes = pushAccessMap[targetEntity];
                if (pushEntityNodes && pushEntityNodes.length > 0) {
                    // 每个pushEntityNode代表配置的一个remoteEntity 
                    await Promise.all(pushEntityNodes.map(async (node) => {
                        const { projection, groupByUsers, getRemotePushInfo: getRemoteAccessInfo, endpoint, entity, actions, onSynchronized } = node;
                        if (!actions || actions.includes(action)) {
                            const pushed = [];
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
                            }, { dontCollect: true, includedDeleted: true });
                            // userId就是需要发送给远端的user，但是要将本次操作的user过滤掉（操作的原本产生者）
                            const userSendDict = groupByUsers(rows);
                            const pushToUserIdFn = async (userId) => {
                                const rowIds = userSendDict[userId];
                                // 推送到远端结点的oper
                                const oper2 = {
                                    id: oper.id,
                                    action: action,
                                    data: (action === 'create' && data instanceof Array) ? data.filter(ele => rowIds.includes(ele.id)) : data,
                                    filter: {
                                        id: rowIds.length === 1 ? rowIds[0] : {
                                            $in: rowIds,
                                        }
                                    },
                                    bornAt: oper.bornAt,
                                    targetEntity,
                                };
                                const { url } = await getRemoteAccessInfo(userId);
                                try {
                                    await this.pushOper(oper2 /** 这里不明白为什么过不去 */, userId, url, endpoint);
                                    return {
                                        userId,
                                        rowIds,
                                    };
                                }
                                catch (err) {
                                    return {
                                        userId,
                                        rowIds,
                                        error: err,
                                    };
                                }
                            };
                            for (const userId in userSendDict) {
                                if (userId !== operatorId) {
                                    pushed.push(pushToUserIdFn(userId));
                                }
                            }
                            if (pushed.length > 0) {
                                const result = await Promise.all(pushed);
                                if (onSynchronized) {
                                    await onSynchronized({
                                        action: action,
                                        data: data,
                                        result,
                                    }, context);
                                }
                                else {
                                    const errResult = result.find(ele => !!ele.error);
                                    if (errResult) {
                                        console.error('同步数据时出错', errResult.userId, errResult.rowIds, errResult.error);
                                        throw errResult.error;
                                    }
                                }
                            }
                        }
                    }));
                    return entityIds.length * pushEntityNodes.length;
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
                console.log('接收到来自远端的sync数据', entity, JSON.stringify(body));
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
                    (0, assert_1.default)(userId);
                    context.setCurrentUserId(userId);
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
                            const { id, targetEntity, action, data, bornAt, filter } = oper;
                            const ids = (0, filter_1.getRelevantIds)(filter);
                            (0, assert_1.default)(ids.length > 0);
                            this.checkOperationConsistent(targetEntity, ids, bornAt);
                            const operation = {
                                id,
                                data,
                                action,
                                filter: {
                                    id: ids.length === 1 ? ids[0] : {
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
                        (0, assert_1.default)(maxHisOper);
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
