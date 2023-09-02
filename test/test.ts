import { AppLoader } from '../src/AppLoader';
import { EntityDict } from '../../jichuang/src/oak-app-domain';
import Context from './meta/Context';
import dbConfig from './meta/dbConfig';

async function main() {
    const appLoader = new AppLoader<EntityDict, Context>(`${__dirname}/../../jichuang`, () => async (store) => new Context(store), dbConfig);
    await appLoader.mount(true);
    await appLoader.initialize(true);
    await appLoader.unmount();
    console.log('data initialized');
}


main()
    .then(
        () => console.log('success')
    ).catch(
        (err) => console.error(err)
    );
