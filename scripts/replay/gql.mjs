export async function gql(query, variables={}) {
  for (const url of ["https://api.morpho.org/graphql","https://blue-api.morpho.org/graphql"]) {
    try {
      const r = await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query,variables})});
      const j = await r.json();
      if (j.errors) { console.error(url, JSON.stringify(j.errors).slice(0,500)); if(!j.data) continue; }
      return j.data;
    } catch(e){ console.error(url,e.message); }
  }
}
