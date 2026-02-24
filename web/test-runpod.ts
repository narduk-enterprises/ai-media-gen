import { $fetch } from 'ofetch';

async function test() {
  try {
    const res: any = await $fetch('https://api.runpod.io/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.RUNPOD_API_KEY
      },
      body: { 
        query: `
          query {
            dataCenters {
              id
              name
            }
          }
        ` 
      }
    });
    console.log(JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.error("error:", err.data || err.message);
  }
}

test();
