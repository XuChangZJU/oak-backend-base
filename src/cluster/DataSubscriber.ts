import { EntityDict, OpRecord } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { Namespace } from 'socket.io';
import { getClusterInfo } from './env';
/**
 * 集群行为备忘：
 * 当socket.io通过adapter在集群间通信时，测试行为如下（测试环境为pm2 + cluster-adapter，其它adpater启用时需要再测一次）：
 * 1）当client连接到node1并join room1时，只有node1上会有create room事件（room结构本身在结点间并不共享）
 * 2）当某一个node执行 .adapter.to('room1').emit()时，连接到任一结点的client均能收到消息（但使用room可以实现跨结点推包）
 * 3) serverSideEmit执行时如果有callback，而不是所有的接收者都执行callback的话，会抛出一个异常（意味着不需要本结点来判定是否收到全部的返回值了）
 */


export default class DataSubscriber<ED extends EntityDict & BaseEntityDict, Context extends BackendRuntimeContext<ED>> {
    private ns: Namespace;
    private contextBuilder: (scene?: string) => Promise<Context>;

    constructor(ns: Namespace, contextBuilder: (scene?: string) => Promise<Context>) {
        this.ns = ns;
        this.contextBuilder = contextBuilder;
        this.startup();
    }

    /**
     * 来自外部的socket连接，监听数据变化
     */
    private startup() {
        this.ns.on('connection', async (socket) => {
            try {
                const { instanceId } = getClusterInfo();
                console.log('on connection', instanceId);
                socket.on('sub', async (events: string[]) => {
                    events.forEach(
                        (event) => socket.join(event)
                    );
                });
    
                socket.on('unsub', (events: string[]) => {
                    // console.log('instance:', process.env.NODE_APP_INSTANCE, 'on unsub', JSON.stringify(ids));
                    events.forEach(
                        (id) => {
                            socket.leave(id);
                        }
                    );
                });
            }
            catch (err: any) {
                socket.emit('error', err.toString());
            }
        });
    }

    publishEvent(event: string, records: OpRecord<ED>[], sid?: string) {
        const { instanceId } = getClusterInfo();
        console.log('publishEvent', instanceId);
        if (sid) {
            this.ns.to(event).except(sid).emit('data', records);
        }
        else {
            this.ns.to(event).emit('data', records);
        }
    }
}