import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class CdkRdsPgdslStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps){
    super(scope, id, {env: {
        account: process.env.CDK_DEFAULT_ACCOUNT ?? 'default_account',
        region: process.env.CDK_DEFAULT_REGION ?? 'default_region',
      },...props});

    const dbName = 'my_initial_database';
    const vpc = new ec2.Vpc(this, 'Athena-POC-VPC', {maxAzs: 2});
    const rdsRole = new iam.Role(this, 'RDSRole', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
    });

    rdsRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "rds-db:connect",
        "secretsmanager:GetSecretValue",
        "sts:AssumeRole"
      ],
      resources: ["*"],
    }));

    const dbSecret = new secretsmanager.Secret(this, 'DBSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'postgresadmin' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        excludeCharacters: '"@/',
      },
    });

    const dbInstance = new rds.DatabaseInstance(this, 'DatabaseInstance', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15_3 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      vpc,
      allocatedStorage: 15,
      backupRetention: cdk.Duration.days(3),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      databaseName: dbName,
      credentials: rds.Credentials.fromSecret(dbSecret),
    });
    dbInstance.grantConnect(rdsRole, "postgresadmin");
    // dbInstance.node.addDependency(rdsRole)

    const dbInstanceEndpointAddress = dbInstance.dbInstanceEndpointAddress;
    const dbInstanceEndpointPort = dbInstance.dbInstanceEndpointPort;
    const dbSecurityGroupId = dbInstance.connections.securityGroups[0].securityGroupId;

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
