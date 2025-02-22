import { Response } from "express";
import uniqid from "uniqid";
import cloneDeep from "lodash/cloneDeep";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import * as bq from "@google-cloud/bigquery";
import { AuthRequest } from "../types/AuthRequest";
import { getContextFromReq } from "../services/organizations";
import {
  DataSourceParams,
  DataSourceType,
  DataSourceSettings,
  DataSourceInterface,
  ExposureQuery,
} from "../../types/datasource";
import {
  getSourceIntegrationObject,
  getNonSensitiveParams,
  mergeParams,
  encryptParams,
  testQuery,
} from "../services/datasource";
import { getOauth2Client } from "../integrations/GoogleAnalytics";
import {
  createExperiment,
  getSampleExperiment,
} from "../models/ExperimentModel";
import { getQueriesByIds } from "../models/QueryModel";
import { findSegmentsByDataSource } from "../models/SegmentModel";
import { createManualSnapshot } from "../services/experiments";
import { findDimensionsByDataSource } from "../models/DimensionModel";
import {
  createDataSource,
  getDataSourcesByOrganization,
  getDataSourceById,
  deleteDatasourceById,
  updateDataSource,
} from "../models/DataSourceModel";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import {
  insertMetric,
  getMetricsByDatasource,
  getSampleMetrics,
  getMetricMap,
} from "../models/MetricModel";
import { EventAuditUserForResponseLocals } from "../events/event-types";
import { deleteInformationSchemaById } from "../models/InformationSchemaModel";
import { deleteInformationSchemaTablesByInformationSchemaId } from "../models/InformationSchemaTablesModel";
import { queueCreateAutoGeneratedMetrics } from "../jobs/createAutoGeneratedMetrics";
import { MetricType } from "../../types/metric";
import { TemplateVariables } from "../../types/sql";
import { getUserById } from "../services/users";
import { AuditUserLoggedIn } from "../../types/audit";
import {
  createDimensionSlices,
  getLatestDimensionSlices,
  getDimensionSlicesById,
} from "../models/DimensionSlicesModel";
import { DimensionSlicesQueryRunner } from "../queryRunners/DimensionSlicesQueryRunner";

export async function postSampleData(
  req: AuthRequest,
  res: Response<
    { status: 200; experiment: string },
    EventAuditUserForResponseLocals
  >
) {
  req.checkPermissions("createMetrics", "");
  req.checkPermissions("createAnalyses", "");

  const context = getContextFromReq(req);
  const { org, userId } = context;
  const orgId = org.id;
  const statsEngine = org.settings?.statsEngine || DEFAULT_STATS_ENGINE;

  const existingMetrics = await getSampleMetrics(context);

  let metric1 = existingMetrics.filter((m) => m.type === "binomial")[0];
  if (!metric1) {
    metric1 = {
      id: uniqid("met_sample_"),
      datasource: "",
      owner: "",
      ignoreNulls: false,
      inverse: false,
      queries: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      runStarted: null,
      cappingSettings: {
        type: "",
        value: 0,
      },
      windowSettings: {
        type: "",
        delayHours: 0,
        windowValue: 0,
        windowUnit: "hours",
      },
      name: "Sample Conversions",
      description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
      type: "binomial",
      organization: orgId,
      userIdTypes: ["anonymous"],
    };
    await insertMetric(metric1);
  }

  let metric2 = existingMetrics.filter((m) => m.type === "revenue")[0];
  if (!metric2) {
    metric2 = {
      id: uniqid("met_sample_"),
      datasource: "",
      owner: "",
      ignoreNulls: false,
      inverse: false,
      queries: [],
      dateCreated: new Date(),
      dateUpdated: new Date(),
      runStarted: null,
      cappingSettings: {
        type: "",
        value: 0,
      },
      windowSettings: {
        type: "",
        delayHours: 0,
        windowValue: 0,
        windowUnit: "hours",
      },
      name: "Sample Revenue per User",
      description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
      type: "revenue",
      organization: orgId,
      userIdTypes: ["anonymous"],
    };
    await insertMetric(metric2);
  }

  let experiment = await getSampleExperiment(orgId);

  if (!experiment) {
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    experiment = {
      id: uniqid("exp_sample_"),
      organization: orgId,
      archived: false,
      name: "Sample Experiment",
      status: "stopped",
      description: `Part of the GrowthBook sample data set. Feel free to delete when finished exploring.`,
      hypothesis:
        "Making the buttons green on the pricing page will increase conversions",
      previewURL: "",
      targetURLRegex: "",
      variations: [
        {
          id: "0",
          key: "0",
          name: "Control",
          screenshots: [
            {
              path: "/images/pricing-default.png",
            },
          ],
        },
        {
          id: "1",
          key: "1",
          name: "Variation",
          screenshots: [
            {
              path: "/images/pricing-green.png",
            },
          ],
        },
      ],
      autoAssign: false,
      autoSnapshots: false,
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      implementation: "code",
      metrics: [metric1.id, metric2.id],
      owner: userId,
      trackingKey: "sample-experiment",
      exposureQueryId: "",
      hashAttribute: "",
      hashVersion: 2,
      releasedVariationId: "",
      tags: [],
      results: "won",
      winner: 1,
      analysis: `Calling this test a winner given the significant increase in conversions! 💵 🍾

Revenue did not reach 95% significance, but the risk is so low it doesn't seem worth it to keep waiting.

**Ready to get some wins yourself?** [Finish setting up your account](/getstarted)`,
      phases: [
        {
          dateStarted: lastWeek,
          dateEnded: new Date(),
          name: "Main",
          reason: "",
          coverage: 1,
          variationWeights: [0.5, 0.5],
          condition: "",
          namespace: {
            enabled: false,
            name: "",
            range: [0, 1],
          },
        },
      ],
    };

    await createExperiment({
      data: experiment,
      context,
    });

    const metricMap = await getMetricMap(context);

    await createManualSnapshot(
      experiment,
      0,
      [15500, 15400],
      {
        [metric1.id]: [
          {
            users: 15500,
            count: 950,
            mean: 1,
            stddev: 1,
          },
          {
            users: 15400,
            count: 1025,
            mean: 1,
            stddev: 1,
          },
        ],
        [metric2.id]: [
          {
            users: 15500,
            count: 950,
            mean: 26.54,
            stddev: 16.75,
          },
          {
            users: 15400,
            count: 1025,
            mean: 25.13,
            stddev: 16.87,
          },
        ],
      },
      {
        statsEngine,
        dimensions: [],
        pValueCorrection: null,
        sequentialTesting: false,
        sequentialTestingTuningParameter: 0,
        differenceType: "relative",
        regressionAdjusted: false,
      },
      metricMap
    );
  }

  res.status(200).json({
    status: 200,
    experiment: experiment.id,
  });
}

export async function deleteDataSource(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;

  const datasource = await getDataSourceById(context, id);
  if (!datasource) {
    throw new Error("Cannot find datasource");
  }
  req.checkPermissions(
    "createDatasources",
    datasource?.projects?.length ? datasource.projects : ""
  );

  // Make sure this data source isn't the organizations default
  if (org.settings?.defaultDataSource === datasource.id) {
    throw new Error(
      "Error: This is the default data source for your organization. You must select a new default data source in your Organization Settings before deleting this one."
    );
  }

  // Make sure there are no metrics
  const metrics = await getMetricsByDatasource(context, datasource.id);
  if (metrics.length > 0) {
    throw new Error(
      "Error: Please delete all metrics tied to this datasource first."
    );
  }

  // Make sure there are no segments
  const segments = await findSegmentsByDataSource(
    datasource.id,
    datasource.organization
  );
  if (segments.length > 0) {
    throw new Error(
      "Error: Please delete all segments tied to this datasource first."
    );
  }

  // Make sure there are no dimensions
  const dimensions = await findDimensionsByDataSource(
    datasource.id,
    datasource.organization
  );
  if (dimensions.length > 0) {
    throw new Error(
      "Error: Please delete all dimensions tied to this datasource first."
    );
  }

  await deleteDatasourceById(datasource.id, org.id);

  if (datasource.settings?.informationSchemaId) {
    const informationSchemaId = datasource.settings.informationSchemaId;

    await deleteInformationSchemaById(org.id, informationSchemaId);

    await deleteInformationSchemaTablesByInformationSchemaId(
      org.id,
      informationSchemaId
    );
  }

  res.status(200).json({
    status: 200,
  });
}

export async function getDataSources(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  const datasources = await getDataSourcesByOrganization(context);

  if (!datasources || !datasources.length) {
    res.status(200).json({
      status: 200,
      datasources: [],
    });
    return;
  }

  res.status(200).json({
    status: 200,
    datasources: datasources.map((d) => {
      const integration = getSourceIntegrationObject(d);
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        type: d.type,
        settings: d.settings,
        projects: d.projects ?? [],
        params: getNonSensitiveParams(integration),
      };
    }),
  });
}

export async function getDataSource(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const datasource = await getDataSourceById(context, id);
  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
    return;
  }

  const integration = getSourceIntegrationObject(datasource);

  res.status(200).json({
    id: datasource.id,
    name: datasource.name,
    description: datasource.description,
    type: datasource.type,
    params: getNonSensitiveParams(integration),
    settings: datasource.settings,
    projects: datasource.projects,
  });
}

export async function postDataSources(
  req: AuthRequest<{
    name: string;
    description?: string;
    type: DataSourceType;
    params: DataSourceParams;
    settings: DataSourceSettings;
    projects?: string[];
  }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { name, description, type, params, projects } = req.body;
  const settings = req.body.settings || {};

  req.checkPermissions("createDatasources", projects?.length ? projects : "");

  try {
    // Set default event properties and queries
    settings.events = {
      experimentEvent: "$experiment_started",
      experimentIdProperty: "Experiment name",
      variationIdProperty: "Variant name",
      ...settings?.events,
    };

    const datasource = await createDataSource(
      org.id,
      name,
      type,
      params,
      settings,
      undefined,
      description,
      projects
    );

    res.status(200).json({
      status: 200,
      id: datasource.id,
    });
  } catch (e) {
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function putDataSource(
  req: AuthRequest<
    {
      name: string;
      description?: string;
      type: DataSourceType;
      params?: DataSourceParams;
      settings: DataSourceSettings;
      projects?: string[];
      metricsToCreate?: { name: string; type: MetricType; sql: string }[];
    },
    { id: string }
  >,
  res: Response
) {
  const userId = req.userId;

  if (!userId) {
    res.status(403).json({
      status: 403,
      message: "User not found",
    });
    return;
  }

  const user = await getUserById(userId);

  if (!user) {
    res.status(403).json({
      status: 403,
      message: "User not found",
    });
    return;
  }

  const userObj: AuditUserLoggedIn = {
    id: user.id,
    email: user.email,
    name: user.name || "",
  };
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const {
    name,
    description,
    type,
    params,
    settings,
    projects,
    metricsToCreate,
  } = req.body;

  const datasource = await getDataSourceById(context, id);
  if (!datasource) {
    res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
    return;
  }
  // Require higher permissions to change connection settings vs updating query settings
  const permissionLevel = params
    ? "createDatasources"
    : "editDatasourceSettings";
  req.checkPermissions(
    permissionLevel,
    datasource?.projects?.length ? datasource.projects : ""
  );

  if (type && type !== datasource.type) {
    res.status(400).json({
      status: 400,
      message:
        "Cannot change the type of an existing data source. Create a new one instead.",
    });
    return;
  }

  if (metricsToCreate?.length) {
    await queueCreateAutoGeneratedMetrics(
      datasource.id,
      org.id,
      metricsToCreate,
      userObj
    );
  }

  try {
    const updates: Partial<DataSourceInterface> = { dateUpdated: new Date() };

    if (name) {
      updates.name = name;
    }

    if ("description" in req.body) {
      updates.description = description;
    }

    if (settings) {
      updates.settings = settings;
    }

    if (projects) {
      updates.projects = projects;
    }

    if (
      type === "google_analytics" &&
      params &&
      (params as GoogleAnalyticsParams).refreshToken
    ) {
      const oauth2Client = getOauth2Client();
      const { tokens } = await oauth2Client.getToken(
        (params as GoogleAnalyticsParams).refreshToken
      );
      (params as GoogleAnalyticsParams).refreshToken =
        tokens.refresh_token || "";
    }

    if (updates?.projects?.length) {
      req.checkPermissions(permissionLevel, updates.projects);
    }

    // If the connection params changed, re-validate the connection
    // If the user is just updating the display name, no need to do this
    if (params) {
      const integration = getSourceIntegrationObject(datasource);
      mergeParams(integration, params);
      await integration.testConnection();
      updates.params = encryptParams(integration.params);
    }

    await updateDataSource(context, datasource, updates);

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    req.log.error(e, "Failed to update data source");
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function updateExposureQuery(
  req: AuthRequest<
    {
      updates: Partial<ExposureQuery>;
    },
    { datasourceId: string; exposureQueryId: string }
  >,
  res: Response
) {
  const context = getContextFromReq(req);
  const { datasourceId, exposureQueryId } = req.params;
  const { updates } = req.body;

  const dataSource = await getDataSourceById(context, datasourceId);
  if (!dataSource) {
    res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
    return;
  }

  req.checkPermissions(
    "editDatasourceSettings",
    dataSource?.projects?.length ? dataSource.projects : ""
  );

  const copy = cloneDeep<DataSourceInterface>(dataSource);
  const exposureQueryIndex = copy.settings.queries?.exposure?.findIndex(
    (e) => e.id === exposureQueryId
  );
  if (
    exposureQueryIndex === undefined ||
    !copy.settings.queries?.exposure?.[exposureQueryIndex]
  ) {
    res.status(404).json({
      status: 404,
      message: "Cannot find exposure query",
    });
    return;
  }

  const exposureQuery = copy.settings.queries.exposure[exposureQueryIndex];
  copy.settings.queries.exposure[exposureQueryIndex] = {
    ...exposureQuery,
    ...updates,
  };

  try {
    const updates: Partial<DataSourceInterface> = {
      dateUpdated: new Date(),
      settings: copy.settings,
    };

    await updateDataSource(context, dataSource, updates);

    res.status(200).json({
      status: 200,
    });
  } catch (e) {
    req.log.error(e, "Failed to update exposure query");
    res.status(400).json({
      status: 400,
      message: e.message || "An error occurred",
    });
  }
}

export async function postGoogleOauthRedirect(req: AuthRequest, res: Response) {
  req.checkPermissions("createDatasources", "");

  const oauth2Client = getOauth2Client();

  const url = oauth2Client.generateAuthUrl({
    // eslint-disable-next-line
    access_type: "offline",
    // eslint-disable-next-line
    include_granted_scopes: true,
    prompt: "consent",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
  });

  res.status(200).json({
    status: 200,
    url,
  });
}

export async function getQueries(
  req: AuthRequest<null, { ids: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { ids } = req.params;
  const queries = ids.split(",");

  const docs = await getQueriesByIds(org.id, queries);

  // Lookup table so we can return queries in the same order we received them
  const map = new Map(docs.map((d) => [d.id, d]));

  res.status(200).json({
    queries: queries.map((id) => map.get(id) || null),
  });
}

export async function testLimitedQuery(
  req: AuthRequest<{
    query: string;
    datasourceId: string;
    templateVariables?: TemplateVariables;
  }>,
  res: Response
) {
  const context = getContextFromReq(req);

  const { query, datasourceId, templateVariables } = req.body;

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find data source",
    });
  }
  req.checkPermissions(
    "runQueries",
    datasource?.projects?.length ? datasource.projects : ""
  );

  const { results, sql, duration, error } = await testQuery(
    datasource,
    query,
    templateVariables
  );

  res.status(200).json({
    status: 200,
    duration,
    results,
    sql,
    error,
  });
}

export async function getDataSourceMetrics(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { id } = req.params;

  const metrics = await getMetricsByDatasource(context, id);

  res.status(200).json({
    status: 200,
    metrics,
  });
}

export async function getDimensionSlices(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { id } = req.params;

  const dimensionSlices = await getDimensionSlicesById(org.id, id);

  res.status(200).json({
    status: 200,
    dimensionSlices,
  });
}

export async function getLatestDimensionSlicesForDatasource(
  req: AuthRequest<null, { datasourceId: string; exposureQueryId: string }>,
  res: Response
) {
  const { org } = getContextFromReq(req);
  const { datasourceId, exposureQueryId } = req.params;

  const dimensionSlices = await getLatestDimensionSlices(
    org.id,
    datasourceId,
    exposureQueryId
  );

  res.status(200).json({
    status: 200,
    dimensionSlices,
  });
}

export async function postDimensionSlices(
  req: AuthRequest<{
    dataSourceId: string;
    queryId: string;
    lookbackDays: number;
  }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { dataSourceId, queryId, lookbackDays } = req.body;

  const datasourceObj = await getDataSourceById(context, dataSourceId);
  if (!datasourceObj) {
    throw new Error("Could not find datasource");
  }
  req.checkPermissions(
    "runQueries",
    datasourceObj?.projects?.length ? datasourceObj.projects : ""
  );

  const integration = getSourceIntegrationObject(datasourceObj, true);

  const model = await createDimensionSlices({
    organization: org.id,
    dataSourceId,
    queryId,
  });

  const queryRunner = new DimensionSlicesQueryRunner(
    context,
    model,
    integration
  );
  const outputmodel = await queryRunner.startAnalysis({
    exposureQueryId: queryId,
    lookbackDays: Number(lookbackDays) ?? 30,
  });
  res.status(200).json({
    status: 200,
    dimensionSlices: outputmodel,
  });
}

export async function cancelDimensionSlices(
  req: AuthRequest<null, { id: string }>,
  res: Response
) {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const dimensionSlices = await getDimensionSlicesById(org.id, id);
  if (!dimensionSlices) {
    throw new Error("Could not cancel automatic dimension");
  }
  const datasource = await getDataSourceById(
    context,
    dimensionSlices.datasource
  );
  if (!datasource) {
    throw new Error("Could not find datasource");
  }

  req.checkPermissions(
    "runQueries",
    datasource.projects ? datasource.projects : ""
  );

  const integration = getSourceIntegrationObject(datasource, true);

  const queryRunner = new DimensionSlicesQueryRunner(
    context,
    dimensionSlices,
    integration
  );
  await queryRunner.cancelQueries();

  res.status(200).json({
    status: 200,
  });
}

export async function fetchBigQueryDatasets(
  req: AuthRequest<{
    projectId: string;
    client_email: string;
    private_key: string;
  }>,
  res: Response
) {
  const { projectId, client_email, private_key } = req.body;

  try {
    const client = new bq.BigQuery({
      projectId,
      credentials: { client_email, private_key },
    });

    const [datasets] = await client.getDatasets();

    res.status(200).json({
      status: 200,
      datasets: datasets.map((dataset) => dataset.id).filter(Boolean),
    });
  } catch (e) {
    throw new Error(e.message);
  }
}
