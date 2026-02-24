import { $fetch } from 'ofetch';

async function test() {
  const query = `
    query {
      __schema {
        types {
          name
          fields {
            name
          }
        }
      }
    }
  `;
  const res: any = await $fetch('https://api.runpod.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.RUNPOD_API_KEY
    },
    body: { query }
  });
  const t = res.data.__schema.types.filter((t: any) => 
    t.name.toLowerCase().includes('center') || 
    t.name.toLowerCase().includes('country') ||
    t.name.toLowerCase().includes('cloudtype') ||
    t.name.includes('Provider')
  );
  console.log(JSON.stringify(t, null, 2));
}

test();
