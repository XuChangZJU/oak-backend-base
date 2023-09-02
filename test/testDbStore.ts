import { CreateTrigger } from 'oak-domain/lib/types';
import { DbStore } from '../src/DbStore';
import Context from './meta/Context';
import dbConfig from './meta/dbConfig';
import { EntityDict, storageSchema, ActionCascadePathGraph, RelationCascadePathGraph } from 'oak-domain/lib/base-app-domain';
import { generateNewIdAsync } from 'oak-domain/lib/utils/uuid';

const store = new DbStore<EntityDict, Context>(storageSchema, () => async (store) => new Context(store), dbConfig, ActionCascadePathGraph, RelationCascadePathGraph, {});

async function init() {
    store.connect();
    await store.initialize(true);
    store.disconnect();
}


async function testVolatileTrigger() {
    store.connect();

    let execCount = 0;
    store.registerTrigger({
        name: 'ttt',
        entity: 'user',
        action: 'create',
        when: 'commit',
        strict: 'makeSure',
        fn: async(event, context) => {
            const { operation } = event;

            console.log(JSON.stringify(operation));
            execCount ++;
            return 1;
        }
    } as CreateTrigger<EntityDict, 'user', Context>);

    const cxt = new Context(store);
    
    await cxt.begin();
    await store.operate('user', {
        id: await generateNewIdAsync(),
        action: 'create',
        data: {
            id: await generateNewIdAsync(),
            nickname: 'xxx',
            name: 'ccc',
        }
    }, cxt, {});

    await cxt.commit();

    console.log('execCount', execCount);
}


init()
    .then(
        () => testVolatileTrigger()
    );