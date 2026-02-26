import * as fs from 'fs';

const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
if (!RUNPOD_API_KEY) {
  console.error("No RUNPOD_API_KEY found in environment.");
  process.exit(1);
}

const query = `
query {
  myself {
    pods {
      id
      name
      desiredStatus
      machineId
      runtime { ports { ip isIpPublic publicPort privatePort } }
    }
  }
}
`;

async function checkPods() {
  try {
    const res = await fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RUNPOD_API_KEY}`
      },
      body: JSON.stringify({ query })
    });
    
    const data = await res.json();
    const pods = data.data.myself.pods.filter((p: any) => p.desiredStatus === 'RUNNING');
    
    console.log("Currently Running Pods:");
    pods.forEach((p: any) => console.log(`- ID: ${p.id} | Name: ${p.name}`));
    
    const target = pods.find((p: any) => p.name.toLowerCase().includes("slim") || p.name.toLowerCase().includes("80gb") || p.name.toLowerCase().includes("video"));
    if (target) {
      console.log(`\nSelected target pod: ${target.id}`);
      fs.writeFileSync('./scripts/active_pod_id.txt', target.id, 'utf-8');
    } else {
      console.log("\nNo matching 80GB/Slim video pods found!");
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

checkPods();
