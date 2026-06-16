/**
 * Mount helper that registers the same PrimeVue plugins/directives as main.ts, for
 * components that depend on them (Toast, Confirm, v-tooltip). Presentational
 * components with no PrimeVue dependency can use @vue/test-utils' `mount` directly.
 */
import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'

export function mountWithPrimeVue<C>(component: C, options: ComponentMountingOptions<C> = {}) {
  return mount(component as any, {
    ...options,
    global: {
      plugins: [[PrimeVue, {}], ConfirmationService, ToastService],
      directives: { tooltip: Tooltip },
      ...(options.global ?? {}),
    },
  })
}
