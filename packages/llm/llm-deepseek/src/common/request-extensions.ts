/** Prepare plugin-contributed request fields and commit their delivery after HTTP acceptance. */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { DeepSeekLlmApiExtensionRequest, PreparedDeepSeekLlmApiExtensions } from '@deepseek-ai/dsh-deepseek-llm-api-extensions'
import type { DeepSeekAdapterOptions } from './types.ts'

/**
 * Merge contributions without replacing protocol-owned fields. A rejected
 * preparation or a base-field collision reports `REQUEST_EXTENSION`. An
 * acceptance failure is reported and does not fail the request.
 * @param body - serialized protocol request before extension fields.
 * @param options - request identity, purpose, and cancellation.
 * @param prepare - contributor registry captured for this adapter.
 * @param onUnaccepted - receives an acceptance failure after HTTP 2xx.
 * @returns HTTP payload and a commit to invoke only after a successful HTTP response.
 */
export async function prepareRequestExtensions(
  body: DeepSeekLlmApiExtensionRequest['body'],
  options: Omit<DeepSeekLlmApiExtensionRequest, 'body'>,
  prepare: DeepSeekAdapterOptions['prepareExtensions'],
  onUnaccepted: (error: unknown) => void = () => {},
): Promise<{ payload: string; accept(): Promise<void> }> {
  let extensions: PreparedDeepSeekLlmApiExtensions
  try {
    extensions = await prepare({ body, ...options })
  } catch (error) {
    throw new LlmError('DeepSeek request extension preparation failed', 'REQUEST_EXTENSION', { cause: error })
  }
  for (const field of Object.keys(extensions.fields)) {
    if (Object.hasOwn(body, field)) {
      throw new LlmError(`DeepSeek request extension field ${JSON.stringify(field)} collides with the base request`, 'REQUEST_EXTENSION')
    }
  }
  return {
    payload: JSON.stringify({ ...body, ...extensions.fields }),
    async accept() {
      try {
        await extensions.accept()
      } catch (error) {
        onUnaccepted(error)
      }
    },
  }
}
