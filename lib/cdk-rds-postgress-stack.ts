import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {SubnetType} from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class CdkRdsPgdslStack extends cdk.Stack {

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, {
            // Retrieve AWS account ID and region from environment variables, or set to default values if not set
            env: {
                account: process.env.CDK_DEFAULT_ACCOUNT ?? 'default_account',
                region: process.env.CDK_DEFAULT_REGION ?? 'default_region',
            }, ...props
        });
        const dbName = 'my_initial_database'; // Database name for the RDS instance,
        const vpcName = 'Athena-POC-VPC'; // VPC name
        const secretName = 'rds-db-secrets'; // The secret name that can be used as secret name prefix to obtain the secret in other systems
        const vpc = new ec2.Vpc(this, vpcName, {
            maxAzs: 2,
            natGateways: 1, // Indicates the number of NAT gateways to create. Set to 1 for simplicity.
            subnetConfiguration:[{
                cidrMask: 24,
                name: 'ingress',
                subnetType: SubnetType.PUBLIC,
            },
            //{
            //     cidrMask: 24,
            //     name: 'compute',
            //     subnetType: SubnetType.PRIVATE_WITH_EGRESS,
            // },{
            //     cidrMask: 28,
            //     name: 'rds',
            //     subnetType: SubnetType.PRIVATE_ISOLATED,
            // }
            ]
        }); // Create a new VPC with a maximum of 2 availability zones
        const rdsRole = new iam.Role(this, 'RDSRole', { // Create a new IAM role that can be assumed by the RDS service
            assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
        });
        // Add a policy to the role that allows it to connect to RDS databases, get secret values from Secrets Manager, and assume roles
        rdsRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "rds-db:connect",
                "secretsmanager:GetSecretValue",
                "sts:AssumeRole"
            ],
            resources: ["*"],
        }));
        // Create a new secret in Secrets Manager to store the database credentials
        const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
            secretName,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({username: 'postgresadmin'}),
                generateStringKey: 'password',
                excludePunctuation: true,
                excludeCharacters: '"@/',
            },
        });
        // Create a new RDS instance
        const dbInstance = new rds.DatabaseInstance(this, 'DatabaseInstance', {
            engine: rds.DatabaseInstanceEngine.postgres({version: rds.PostgresEngineVersion.VER_13}), // Glue/JDBC doesn't support higher versions as of now. :(
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
                onePerAz: true, // at most one subnet per AZ
            },
            publiclyAccessible: true,
            allocatedStorage: 15,
            instanceIdentifier: 'cdk-rds-postgres-01',
            backupRetention: cdk.Duration.days(3),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            databaseName: dbName, // database name or use the default value which would be postgres in this case
            credentials: rds.Credentials.fromSecret(dbSecret), // Use the secret created above for the database credentials
        });
        dbInstance.grantConnect(rdsRole, "postgresadmin");
        dbInstance.connections.allowDefaultPortInternally("attempting to allow the lambda in the same SG to connect");
        // Retrieve the security group of the RDS instance and add an ingress rule to allow traffic on port 5432
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'DatabaseSecurityGroup', dbInstance.connections.securityGroups[0].securityGroupId);
        // securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'Allow all IPv4 traffic on port 5432 just for demo/temporary usecases');
        securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.allTraffic(), 'Allow all traffic from Lambda function within the VPC');
        securityGroup.addIngressRule(securityGroup, ec2.Port.allTraffic(), 'Self-Referencing Security group (for Glue stuff)')
        // Get endpoint and port details of the RDS instance
        const dbInstanceEndpointAddress = dbInstance.dbInstanceEndpointAddress;
        const dbInstanceEndpointPort = dbInstance.dbInstanceEndpointPort;
        const dbSecurityGroupId = dbInstance.connections.securityGroups[0].securityGroupId;

        // vpc.addInterfaceEndpoint('lambdaEndpoint', {});
        const vpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EndpointService', {
            service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
            open: true, // allow VPC traffic to the endpoint.
            vpc,
            privateDnsEnabled: true, //  If set to true, you can connect to the service using its default DNS hostname.
            securityGroups: [securityGroup]
        });

        new ec2.InterfaceVpcEndpoint(this, 'EndpointService2', {
            service: ec2.InterfaceVpcEndpointAwsService.GLUE,
            open: true, //  Indicates whether the service should allow all traffic or not.
            vpc,
            privateDnsEnabled: true, //  If set to true, you can connect to the service using its default DNS hostname.
            securityGroups: [securityGroup]
        });

        // Add Secrets Manager VPC Endpoint
        new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
            open: true, //  Indicates whether the service should allow all traffic or not.
            vpc,
            privateDnsEnabled: true, //  If set to true, you can connect to the service using its default DNS hostname.
            securityGroups: [securityGroup]
        });

        const s3Endpoint = vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
        });
        // Tag the S3 VPC Endpoint with a name
        cdk.Tags.of(s3Endpoint).add('Name', 'demoS3GatewayEndpoint');

        // Output various details about the created resources as CloudFormation outputs, you can add and remove as you need
        new cdk.CfnOutput(this, 'AthenaVpcIdOutput', {
            value: vpc.vpcId,
            exportName: 'AthenaVpcIdOutput'
        });
        // new cdk.CfnOutput(this, 'AthenaVpcPrivateSubnetsOutput', {
        //     // value: JSON.stringify(vpc.privateSubnets.map(subnet => subnet.subnetId)),
        //     value: vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
        //     exportName: 'AthenaVpcPrivateSubnetsOutput-2',
        // });
        new cdk.CfnOutput(this, 'AthenaVpcPublicSubnetsOutput', {
            value: vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
            exportName: 'AthenaVpcPublicSubnetsOutput-2',
        });
        new cdk.CfnOutput(this, 'AthenaVpcAvailabilityZonesOutput', {
            // value: JSON.stringify(vpc.availabilityZones),
            value: vpc.availabilityZones.join(','),
            exportName: 'AthenaVpcAvailabilityZonesOutput-2',
        });
        new cdk.CfnOutput(this, 'AthenaDatabaseNameOutput', {
            value: dbName,
            exportName: 'AthenaDatabaseNameOutput-2',
        });
        new cdk.CfnOutput(this, 'dbInstanceEndpointAddress', {
            value: dbInstanceEndpointAddress,
            exportName: 'dbInstanceEndpointAddress-2',
        });
        new cdk.CfnOutput(this, 'dbInstanceEndpointPort', {
            value: dbInstanceEndpointPort,
            exportName: 'dbInstanceEndpointPort-2',
        });
        new cdk.CfnOutput(this, 'dbSecurityGroupId', {
            value: dbSecurityGroupId,
            exportName: 'dbSecurityGroupId-2',
        });
    }
}
