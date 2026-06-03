import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Register happy-dom globals (document, window, …) so React Testing Library can mount
// the viewer's components under `bun test`. Mirrors the setup in @walnut/ui.
GlobalRegistrator.register()
