import {
  FeatureDefinitionSDKPayload,
  getFeatureDefinitions,
} from "../../services/features";
import { createApiRequestHandler } from "../../util/handler";
import { getPayloadParamsFromApiKey } from "../../controllers/features";

export const getSdkPayload = createApiRequestHandler()(
  async (req): Promise<FeatureDefinitionSDKPayload & { status: number }> => {
    const { key } = req.params;

    if (!key) {
      throw new Error("Missing API key in request");
    }

    const {
      capabilities,
      environment,
      encrypted,
      projects,
      encryptionKey,
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      hashSecureAttributes,
    } = await getPayloadParamsFromApiKey(key, req);

    const defs = await getFeatureDefinitions({
      context: req.context,
      capabilities,
      environment,
      projects,
      encryptionKey: encrypted ? encryptionKey : "",
      includeVisualExperiments,
      includeDraftExperiments,
      includeExperimentNames,
      hashSecureAttributes,
    });

    return {
      status: 200,
      ...defs,
    };
  }
);
