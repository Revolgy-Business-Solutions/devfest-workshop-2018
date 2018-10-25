
# Example migration of nodejs app with mysql to GKE

## Docker image preparation

docker build -t eu.gcr.io/kot-test-207914/devfest-workshop/app:1

gcloud docker -- push eu.gcr.io/kot-test-207914/devfest-workshop/app:1

## GCP Project preparation

### Create Cluster

In GCP console: https://console.cloud.google.com/kubernetes/ we will create new Kubernetes cluster 

### Prepare CI/CD

In this workshop we use GCP integrated solution for CI/CD. For CI part, there is feature called "Source Repositories" and for the CD part there is "Cloud Build". It's convenient for our use case since we don't need to employ more 3rd party services than necessary.

Many other CI/CD solution can be used for deploying into GKE (i.e. github / gitlab / bitbucket with jenkins / gilab-ci / shipable etc.) but they are not covered in this workshop.

#### Google Source Repositories - GCR

GCR serve as a private git repository. We create repository in Google UI console. In Tools section of menu there is "Source repositories". Here we select tab "Repositories" where we can create new repository. After creation we are presented with commands to either clone repository or connect existing one.

#### Cloud Build

In GCP console, we select Cloud Build from left menu. We will immediately see Build history, which is probably going to be empty because we didnt run our pipeline yet.

When you go to Build triggers tab, you can create your first deployment trigger with "Add Trigger" button.

As of now, trigger creation have 3 steps, i will list here values we want to fill into each step

1 - Source
- Cloud Source Repository

2 - Repository
Select your created 

3 - Trigger settings
- Name - Anything descriptive (optional)
- Trigger type:i (default) Branch
- Branch: .*
- Included and ignored files filter: (default) empty
- Build configuration: cloudbuild.yaml
- cloudbuild.yaml location: (default) /cloudbuild.yaml
- substitution variables:
  - _CLOUDSDK_CONTAINER_CLUSTER: your cluster name 
  - _CLOUDSDK_COMPUTE_ZONE: your cluster zone

### Create CloudSQL database

CloudSQL is mySQL database managed by Google. In the "Storage" section in GCP console is "SQL". Here you can "Create Instance". We want MySQL, second generation database. For our purpose, lowest configurations is sufficient. Here is basic overview of non-default CloudSQL configuration (other than descriptive name and root password)

region and Zone - Select same region and zone as your new cluster
machine type and storage - if not set with "MySQL development" option, select "db-f1-micro" ad machine type and 10 GB storage capacity

Confirm configuration and wait a few minutes for database to create.

#### CloudSQL setup

#### Update firewall rules

all targets

35.191.0.0/16
130.211.0.0/22

port: 30000-32767

## Kubernetes configuration

### Accessing cluster

```
gcloud container clusters list
```

```
gcloud container clusters get-credentials devfest-workshop --zone europe-west1-c
```

### Create namespace

```
kubectl create namespace devfest-demo
```

```
kubectl get namespaces / kubectl get ns
```

```
kubectl config current-context 
```

```
kubectl config set-context $(kubectl config current-context) --namespace devfest-demo
```

### Deployment configuration

```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demoapp
  labels:
    app: demoapp
    version: 1.0.0
spec:
  replicas: 1
  selector:
    matchLabels:
      app: demoapp
  template:
    metadata:
      labels:
        app: demoapp
    spec:
      containers:
        - name: demoapp
          image: _IMAGE_NAME
          ports:
            - containerPort: 3000
```

### Deploying application

```
kubectl create -f app-deployment.yaml
```

### manual scaling of deployment

```
kubectl scale deployment demoapp --replicas 2
```

### Accessing microservices

We have our application deployed, but the only way we can access our pods is via their private IP. Thats not very convenient since we would have to address each replica separately and IP would change with every restart of application.

Kubernetes has feature called services for this. Kubernetes service could be described as loadbalancing reverse proxy above all pods from deployment. 

```
apiVersion: v1
kind: Service
metadata:
  name: demoapp
spec:
  selector:
    app: demoapp
  ports:
  - name: http-demoapp
    protocol: TCP
    port: 80
    targetPort: 8000
  type: LoadBalancer
```

With type: `LoadBalancer` we get assigned external IP address to our service. We can now directly access our service with this IP address

Since it's not the best practice to use these service types and have multiple services accessible directly from the internet, we will edit service in place with kubectl and change service type to NodePort.

```
kubectl edit svc demoapp
```

Next we will make service service accessible with better solution.

#### Kubernetes Ingress

Acording to best practices, system should have allways have only one entrypoint to the cluster from the internet

```
apiVersion: extensions/v1beta1
kind: Ingress
metadata:
  name: basic-ingress
spec:
  backend:
    serviceName: demoapp
    servicePort: 80
```

#### Deployment health cycle - Health and Readiness probess

    readinessProbe:
      tcpSocket:
        port: 3000
      initialDelaySeconds: 10
      periodSeconds: 10

    livenessProbe:
      tcpSocket:
        port: 3000
      initialDelaySeconds: 15
      periodSeconds: 20

kubectl apply -f app.yaml

#### Deployment rollout strategy

We can specify parameters of upgrading deployment to new image version.
Default upgrade strategy is rolling update with 25% max unavailable and 25% max surge

```
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1
    maxUnavailable: 0
```

#### kubectl set image deployment 

We don't have to apply whole deployment configuration when we need to upgrade deployment image

```
kubectl set image deployment.v1.apps/demoapp demoapp=IMAGE_TAG
```

#### Deployment resource management

We can limit the amount of resources that each container can utilize on node as well as how much is guaranteed for container to have. 

```
resources: 
  requests: 
    cpu: 200m
    memory: 128Mi 
  limits: 
    cpu: 300m 
    memory: 256Mi
```

### Deployment autoscaling

We can turn on deployment autoscaling manually with kubectl cli.

```
kubectl autoscale deployment demoapp --min 1 --max 3 --cpu-percent 60
```

HPA can be also deploy from file which is usualy preffered. Here we will try to get configuration setup of already running resource. `-o yaml` parameter returns yaml representation of deployed resource

```
kubectl get hpa demoapp -o yaml
```

We can delete internal kubernetes generated field from given yaml config and we will end up with usable configuration.

```
apiVersion: autoscaling/v1
kind: HorizontalPodAutoscaler
metadata:
  name: demoapp
spec:
  maxReplicas: 3
  minReplicas: 1
  scaleTargetRef:
    apiVersion: extensions/v1beta1
    kind: Deployment
    name: demoapp
  targetCPUUtilizationPercentage: 60
```

Now we can try generate some load on our application

### Sidecar containers

In some situations, multiple containers per pod can be deployed together. It should serve as helper container only, we shouldn't deploy multiple core processes to one pod.

In this scenario we will deploy CloudSQL proxy which will allow us secure connection to CLoudSQL instance.


