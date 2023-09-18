import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
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
        const vpc = new ec2.Vpc(this, vpcName, {maxAzs: 2}); // Create a new VPC with a maximum of 2 availability zones
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
            engine: rds.DatabaseInstanceEngine.postgres({version: rds.PostgresEngineVersion.VER_15_3}),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
            vpc,
            vpcSubnets: {subnetType: ec2.SubnetType.PUBLIC},
            publiclyAccessible: true,
            allocatedStorage: 15,
            backupRetention: cdk.Duration.days(3),
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            databaseName: dbName, // database name or use the default value which would be postgres in this case
            credentials: rds.Credentials.fromSecret(dbSecret), // Use the secret created above for the database credentials
        });
        dbInstance.grantConnect(rdsRole, "postgresadmin");
        // Retrieve the security group of the RDS instance and add an ingress rule to allow traffic on port 5432
        const securityGroup = ec2.SecurityGroup.fromSecurityGroupId(this, 'DatabaseSecurityGroup', dbInstance.connections.securityGroups[0].securityGroupId);
        // securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'Allow all IPv4 traffic on port 5432 just for demo/temporary usecases');
        securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic(), 'Allow all traffic from Lambda function within the VPC');
        // Get endpoint and port details of the RDS instance
        const dbInstanceEndpointAddress = dbInstance.dbInstanceEndpointAddress;
        const dbInstanceEndpointPort = dbInstance.dbInstanceEndpointPort;
        const dbSecurityGroupId = dbInstance.connections.securityGroups[0].securityGroupId;

        // vpc.addInterfaceEndpoint('lambdaEndpoint', {});
        const vpcEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EndpointService', {
            service: ec2.InterfaceVpcEndpointAwsService.LAMBDA,
            vpc,
            privateDnsEnabled: false,
            securityGroups: [securityGroup]
        });

        // Output various details about the created resources as CloudFormation outputs, you can add and remove as you need
        new cdk.CfnOutput(this, 'AthenaVpcIdOutput', {
            value: vpc.vpcId,
        });
        new cdk.CfnOutput(this, 'AthenaVpcPrivateSubnetsOutput', {
            // value: JSON.stringify(vpc.privateSubnets.map(subnet => subnet.subnetId)),
            value: vpc.privateSubnets.map(subnet => subnet.subnetId).join(','),
            exportName: 'AthenaVpcPrivateSubnetsOutput-2',
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
