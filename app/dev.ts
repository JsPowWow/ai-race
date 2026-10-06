/// <reference types="vite/client" />
// Только при разработке (npm run dev): dommy предупредит о привязке, у которой нет владельца, — её никто
// не освободит, и она живёт, пока живут её сигналы. В собранном сайте этого кода нет (DEV там false).
// Импортируется в main.ts первым: до того, как модули вкладок начнут строить свои узлы.
import { defineDommyConfig } from '@reely/dommy';
import { scopedLogger } from '@reely/logger';

if (import.meta.env.DEV) defineDommyConfig({ useLogger: true, logger: scopedLogger('dommy').setEnabled(true), warnUnowned: true });
