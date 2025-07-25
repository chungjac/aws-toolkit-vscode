/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { TreeItemCollapsibleState } from 'vscode'
import { ApiGatewayNode } from '../awsService/apigateway/explorer/apiGatewayNodes'
import { SchemasNode } from '../eventSchemas/explorer/schemasNode'
import { CloudFormationNode } from '../lambda/explorer/cloudFormationNodes'
import { CloudWatchLogsNode } from '../awsService/cloudWatchLogs/explorer/cloudWatchLogsNode'
import { LambdaNode } from '../lambda/explorer/lambdaNodes'
import { S3Node } from '../awsService/s3/explorer/s3Nodes'
import { EcrNode } from '../awsService/ecr/explorer/ecrNode'
import { RedshiftNode } from '../awsService/redshift/explorer/redshiftNode'
import { IotNode } from '../awsService/iot/explorer/iotNodes'
import { Region } from '../shared/regions/endpoints'
import { defaultPartition, RegionProvider } from '../shared/regions/regionProvider'
import { AWSTreeNodeBase } from '../shared/treeview/nodes/awsTreeNodeBase'
import { StepFunctionsNode } from '../stepFunctions/explorer/stepFunctionsNodes'
import { SsmDocumentNode } from '../ssmDocument/explorer/ssmDocumentNode'
import { ResourcesNode } from '../dynamicResources/explorer/nodes/resourcesNode'
import { AppRunnerNode } from '../awsService/apprunner/explorer/apprunnerNode'
import { DocumentDBNode } from '../docdb/explorer/docdbNode'
import { DefaultDocumentDBClient } from '../shared/clients/docdbClient'
import { AppRunnerClient } from '../shared/clients/apprunner'
import { DefaultEcrClient } from '../shared/clients/ecrClient'
import { DefaultRedshiftClient } from '../shared/clients/redshiftClient'
import { DefaultIotClient } from '../shared/clients/iotClient'
import { S3Client } from '../shared/clients/s3'
import { DefaultSchemaClient } from '../shared/clients/schemaClient'
import { getEcsRootNode } from '../awsService/ecs/model'
import { compareTreeItems, TreeShim } from '../shared/treeview/utils'
import { Ec2ParentNode } from '../awsService/ec2/explorer/ec2ParentNode'
import { Ec2Client } from '../shared/clients/ec2'
import { SagemakerParentNode } from '../awsService/sagemaker/explorer/sagemakerParentNode'
import { SagemakerClient } from '../shared/clients/sagemaker'

interface ServiceNode {
    allRegions?: boolean
    serviceId: string
    /**
     * Decides if the node should be shown. Example:
     * ```
     * when: () => DevSettings.instance.isDevMode()
     * ```
     */
    when?: () => boolean
    createFn: (regionCode: string, partitionId: string) => any
}

const serviceCandidates: ServiceNode[] = [
    {
        serviceId: 'apigateway',
        createFn: (regionCode: string, partitionId: string) => new ApiGatewayNode(partitionId, regionCode),
    },
    {
        serviceId: 'apprunner',
        createFn: (regionCode: string) => new AppRunnerNode(regionCode, new AppRunnerClient(regionCode)),
    },
    {
        serviceId: 'cloudformation',
        createFn: (regionCode: string) => new CloudFormationNode(regionCode),
    },
    {
        serviceId: 'docdb',
        createFn: (regionCode: string) => new DocumentDBNode(DefaultDocumentDBClient.create(regionCode)),
    },
    {
        serviceId: 'logs',
        createFn: (regionCode: string) => new CloudWatchLogsNode(regionCode),
    },
    {
        serviceId: 'ec2',
        createFn: (regionCode: string, partitionId: string) =>
            new Ec2ParentNode(regionCode, partitionId, new Ec2Client(regionCode)),
    },
    {
        serviceId: 'ecr',
        createFn: (regionCode: string) => new EcrNode(new DefaultEcrClient(regionCode)),
    },
    {
        serviceId: 'redshift',
        createFn: (regionCode: string) => new RedshiftNode(new DefaultRedshiftClient(regionCode)),
    },
    {
        serviceId: 'ecs',
        createFn: (regionCode: string) => new TreeShim(getEcsRootNode(regionCode)),
    },
    {
        serviceId: 'iot',
        createFn: (regionCode: string) => new IotNode(new DefaultIotClient(regionCode)),
    },
    {
        serviceId: 'lambda',
        createFn: (regionCode: string) => new LambdaNode(regionCode),
    },
    {
        serviceId: 's3',
        createFn: (regionCode: string) => new S3Node(new S3Client(regionCode)),
    },
    {
        serviceId: 'api.sagemaker',
        createFn: (regionCode: string) => new SagemakerParentNode(regionCode, new SagemakerClient(regionCode)),
    },
    {
        serviceId: 'schemas',
        createFn: (regionCode: string) => new SchemasNode(new DefaultSchemaClient(regionCode)),
    },
    {
        serviceId: 'states',
        createFn: (regionCode: string) => new StepFunctionsNode(regionCode),
    },
    {
        serviceId: 'ssm',
        createFn: (regionCode: string) => new SsmDocumentNode(regionCode),
    },
    {
        allRegions: true,
        serviceId: 'cloudcontrol',
        createFn: (regionCode: string) => new ResourcesNode(regionCode),
    },
]

/**
 * An AWS Explorer node representing a region.
 * Contains resource types as child nodes (for example, nodes representing
 * an account's Lambda Functions and CloudFormation stacks for this region)
 */
export class RegionNode extends AWSTreeNodeBase {
    private region: Region
    public override readonly regionCode: string

    public get regionName(): string {
        return this.region.name
    }

    public constructor(
        region: Region,
        private readonly regionProvider: RegionProvider
    ) {
        super(region.name, TreeItemCollapsibleState.Expanded)
        this.contextValue = 'awsRegionNode'
        this.region = region
        this.regionCode = region.id
        this.update(region)
    }

    public override async getChildren(): Promise<AWSTreeNodeBase[]> {
        //  Services that are candidates to add to the region explorer.
        //  `serviceId`s are checked against ~/resources/endpoints.json to see whether or not the service is available in the given region.
        //  If the service is available, we use the `createFn` to generate the node for the region.
        //  This interface exists so we can add additional nodes to the array (otherwise Typescript types the array to what's already in the array at creation)
        const partitionId = this.regionProvider.getPartitionId(this.regionCode) ?? defaultPartition
        const childNodes: AWSTreeNodeBase[] = []
        for (const service of serviceCandidates) {
            if (service.when !== undefined && !service.when()) {
                continue
            }
            if (service.allRegions || this.regionProvider.isServiceInRegion(service.serviceId, this.regionCode)) {
                const node = service.createFn(this.regionCode, partitionId)
                if (node !== undefined) {
                    node.serviceId = service.serviceId
                    childNodes.push(node)
                }
            }
        }

        return this.sortNodes(childNodes)
    }

    private sortNodes(nodes: AWSTreeNodeBase[]) {
        return nodes.sort((a, b) => {
            // Always sort `ResourcesNode` at the bottom
            return a instanceof ResourcesNode ? 1 : b instanceof ResourcesNode ? -1 : compareTreeItems(a, b)
        })
    }
    public update(region: Region): void {
        this.region = region
        this.label = this.regionName
        this.tooltip = `${this.regionName} [${this.regionCode}]`
    }
}
