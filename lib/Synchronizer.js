"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const relationPath_1 = require("oak-domain/lib/utils/relationPath");
const assert_1 = tslib_1.__importDefault(require("assert"));
const path_1 = require("path");
const lodash_1 = require("oak-domain/lib/utils/lodash");
const filter_1 = require("oak-domain/lib/store/filter");
const OAK_SYNC_HEADER_ITEM = 'oak-sync-remote-id';
class Synchronizer {
    config;
    schema;
    selfEncryptInfo;
    remotePullInfoMap = {};
    pullMaxBornAtMap = {};
    remotePushChannel = {};
    /**
     * 向某一个远端对象push opers。根据幂等性，这里如果失败了必须反复推送
     * @param channel
     * @param retry
     */
    async pushOnChannel(channel, retry) {
        const { queue, api, nextPushTimestamp } = channel;
        (0, assert_1.default)(nextPushTimestamp);
        // 失败重试的间隔，失败次数多了应当适当延长，最多延长到1024秒
        let nextPushTimestamp2 = typeof retry === 'number' ? Math.pow(2, Math.min(retry, 10)) : 1;
        channel.nextPushTimestamp = nextPushTimestamp2 * 1000 + Date.now();
        (0, assert_1.default)(this.selfEncryptInfo);
        const opers = queue.map(ele => ele.oper);
        let restOpers = [];
        let needRetry = false;
        let json;
        try {
            // todo 加密
            console.log('向远端结点sync数据', api, JSON.stringify(opers));
            const res = await fetch(api, {
                method: 'post',
                headers: {
                    'Content-Type': 'application/json',
                    [OAK_SYNC_HEADER_ITEM]: this.selfEncryptInfo.id,
                },
                body: JSON.stringify(opers),
            });
            if (res.status !== 200) {
                throw new Error(`sync数据时，访问api「${api}」的结果不是200。「${res.status}」`);
            }
            json = await res.json();
        }
        catch (err) {
            console.error('sync push时出现error', err);
            needRetry = true;
            restOpers = queue;
        }
        if (!needRetry) {
            /**
             * 返回结构见this.getSelfEndpoint
             */
            const { successIds, failed } = json;
            if (failed) {
                needRetry = true;
                const { id, error } = failed;
                console.error('同步过程中发生异常', id, error);
            }
            for (const req of queue) {
                if (successIds.includes(req.oper.id)) {
                    req.resolve();
                }
                else {
                    restOpers.push(req);
                }
            }
        }
        if (restOpers.length > 0) {
            const interval = Math.max(0, channel.nextPushTimestamp - Date.now());
            const retry2 = needRetry ? (typeof retry === 'number' ? retry + 1 : 1) : undefined;
            console.log('need retry', retry2);
            setTimeout(() => this.pushOnChannel(channel, retry2), interval);
        }
        else {
            channel.handler = undefined;
            channel.nextPushTimestamp = undefined;
        }
    }
    // 将产生的oper推送到远端Node。注意要尽量在本地阻止重复推送
    /**
     * 推向远端Node的oper，需要严格保证按产生的时间序推送。根据幂等原理，这里必须要推送成功
     * 因此在这里要实现两点：
     * 1）oper如果推送失败了，必须留存在queue中，以保证在后面产生的oper之前推送
     * 2）当对queue中增加oper时，要检查是否有重（有重说明之前失败过），如果无重则将之放置在队列尾
     *
     * 其实这里还无法严格保证先产生的oper一定先到达被推送，因为volatile trigger是在事务提交后再发生的，但这种情况在目前应该跑不出来，在实际执行oper的时候assert掉先。by Xc 20240226
     */
    async pushOper(oper, userId, url, endpoint, nextPushTimestamp) {
        if (!this.remotePushChannel[userId]) {
            this.remotePushChannel[userId] = {
                api: (0, path_1.join)(url, 'endpoint', endpoint),
                queue: [],
            };
        }
        const channel = this.remotePushChannel[userId];
        // 要去重且有序
        let existed = false;
        let idx = 0;
        for (; idx < channel.queue.length; idx++) {
            if (channel.queue[idx].oper.id === oper.id) {
                existed = true;
                break;
            }
            else if (channel.queue[idx].oper.bornAt > oper.bornAt) {
                break;
            }
        }
        if (!existed) {
            const now = Date.now();
            const nextPushTimestamp2 = nextPushTimestamp || now + 1000;
            const waiter = new Promise((resolve, reject) => {
                if (!existed) {
                    channel.queue.splice(idx, 0, {
                        oper,
                        resolve,
                        reject,
                    });
                }
            });
            if (!channel.handler) {
                channel.nextPushTimestamp = nextPushTimestamp2;
                channel.handler = setTimeout(async () => {
                    (0, assert_1.default)(this.selfEncryptInfo);
                    await this.pushOnChannel(channel);
                }, nextPushTimestamp2 - now);
            }
            else if (channel.nextPushTimestamp && channel.nextPushTimestamp > nextPushTimestamp2) {
                // 当前队列的开始时间要晚于自身的要求，要求提前开始
                channel.nextPushTimestamp = nextPushTimestamp2;
            }
            await waiter;
        }
        else {
            // 感觉应该跑不出来
            console.warn('在sync数据时，遇到了重复推送的oper', JSON.stringify(oper), userId, url);
        }
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
                }, { dontCollect: true, forUpdate: true });
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
                                await this.pushOper(oper2 /** 这里不明白为什么TS过不去 */, userId, url, endpoint);
                            };
                            for (const userId in userSendDict) {
                                if (userId !== operatorId) {
                                    pushed.push(pushToUserIdFn(userId));
                                }
                            }
                            if (pushed.length > 0) {
                                await Promise.all(pushed);
                                if (onSynchronized) {
                                    await onSynchronized({
                                        action: action,
                                        data: data,
                                        rowIds: entityIds,
                                    }, context);
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
                const successIds = [];
                let failed;
                // todo 这里先缓存，不考虑本身同步相关信息的更新
                if (!this.remotePullInfoMap[entity]) {
                    this.remotePullInfoMap[entity] = {};
                }
                if (!this.remotePullInfoMap[entity][id]) {
                    const { getRemotePullInfo, pullEntities } = this.config.remotes.find(ele => ele.entity === entity);
                    const pullEntityDict = {};
                    if (pullEntities) {
                        pullEntities.forEach((def) => pullEntityDict[def.entity] = def);
                    }
                    this.remotePullInfoMap[entity][id] = {
                        pullInfo: await getRemotePullInfo(id),
                        pullEntityDict,
                    };
                }
                const { pullInfo, pullEntityDict } = this.remotePullInfoMap[entity][id];
                const { userId, algorithm, publicKey } = pullInfo;
                // todo 解密
                (0, assert_1.default)(userId);
                if (!this.pullMaxBornAtMap.hasOwnProperty(id)) {
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
                    this.pullMaxBornAtMap[id] = maxHisOper?.bornAt || 0;
                }
                let maxBornAt = this.pullMaxBornAtMap[id];
                context.setCurrentUserId(userId);
                const opers = body;
                const outdatedOpers = opers.filter(ele => ele.bornAt <= maxBornAt);
                const freshOpers = opers.filter(ele => ele.bornAt > maxBornAt);
                await Promise.all([
                    // 无法严格保证推送按bornAt，所以一旦还有outdatedOpers，检查其已经被apply
                    (async () => {
                        const ids = outdatedOpers.map(ele => ele.id);
                        if (ids.length > 0) {
                            const opersExisted = await context.select('oper', {
                                data: {
                                    id: 1,
                                },
                                filter: {
                                    id: {
                                        $in: ids,
                                    }
                                }
                            }, { dontCollect: true });
                            if (opersExisted.length < ids.length) {
                                const missed = (0, lodash_1.difference)(ids, opersExisted.map(ele => ele.id));
                                // todo 这里如果远端业务逻辑严格，发生乱序应是无关的oper，直接执行就好 by Xc
                                throw new Error(`在sync过程中发现有丢失的oper数据「${missed}」`);
                            }
                            successIds.push(...ids);
                        }
                    })(),
                    (async () => {
                        for (const freshOper of freshOpers) {
                            // freshOpers是按bornAt序产生的
                            const { id, targetEntity, action, data, bornAt, filter } = freshOper;
                            const ids = (0, filter_1.getRelevantIds)(filter);
                            (0, assert_1.default)(ids.length > 0);
                            try {
                                if (pullEntityDict && pullEntityDict[targetEntity]) {
                                    const { process } = pullEntityDict[targetEntity];
                                    if (process) {
                                        await process(action, data, context);
                                    }
                                }
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
                                successIds.push(id);
                                maxBornAt = bornAt;
                            }
                            catch (err) {
                                console.error('sync时出错', entity, JSON.stringify(freshOper));
                                failed = {
                                    id,
                                    error: err.toString(),
                                };
                                break;
                            }
                        }
                    })()
                ]);
                this.pullMaxBornAtMap[id] = maxBornAt;
                return {
                    successIds,
                    failed,
                };
            }
        };
    }
}
exports.default = Synchronizer;
