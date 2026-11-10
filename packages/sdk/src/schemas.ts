import { z } from 'zod/v4'
import {
  captureKeySearchSchema,
  deliveryBundleSchema,
  deliveryLocaleSchema,
  deliveryMetaSchema as contractMetaSchema,
  deliveryOutdatedSchema,
  deliveryProjectsSchema,
} from '@localness/contract'

export {
  captureKeySearchSchema,
  deliveryBundleSchema,
  deliveryLocaleSchema,
  deliveryOutdatedSchema,
  deliveryProjectsSchema,
}
export type {
  CaptureKeyHit,
  CaptureKeySearch,
  DeliveryBundle,
  DeliveryLocale,
  DeliveryOutdated,
  DeliveryProjectRef,
  DeliveryProjects,
  ProjectRelease,
} from '@localness/contract'

// TODO: drop this extension once a @localness/contract release (> 0.4.0)
// includes `sourceLocale` on the meta schema, and re-export the contract's.
export const deliveryMetaSchema = contractMetaSchema.extend({
  sourceLocale: z.string().optional(),
})
export type DeliveryMeta = z.infer<typeof deliveryMetaSchema>

export const deliveryLocaleStateNameSchema = z.enum([
  'draft',
  'published',
  'outdated',
  'unpublished',
])
export type DeliveryLocaleStateName = z.infer<
  typeof deliveryLocaleStateNameSchema
>

// TODO: temporary mirror of shared/contract/delivery.ts in the Localness repo.
// Replace with the @localness/contract export once a release includes
// `GET /api/v1/keys/states` (> 0.4.0).
export const deliveryKeyStatesSchema = z.object({
  sourceLocale: z.string(),
  keys: z.array(
    z.object({
      id: z.number(),
      key: z.string(),
      releaseIds: z.array(z.number()),
      draft: z.boolean(),
      locales: z.record(
        z.string(),
        z.object({
          draftText: z.string().nullable(),
          publishedText: z.string().nullable(),
          state: deliveryLocaleStateNameSchema,
        }),
      ),
    }),
  ),
  total: z.number(),
  offset: z.number(),
  limit: z.number(),
  generatedAt: z.string(),
})
export type DeliveryKeyStates = z.infer<typeof deliveryKeyStatesSchema>
export type DeliveryKeyState = DeliveryKeyStates['keys'][number]
