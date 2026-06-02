import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Register happy-dom globals (document, window, …) so React Testing Library can
// mount icon components under `bun test`.
GlobalRegistrator.register()
