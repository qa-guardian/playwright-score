import { notAFactory } from './fixtures';

const t: any = notAFactory();

t('a call through a non-factory result is not a test', async () => {});
