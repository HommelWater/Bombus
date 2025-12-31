document.addEventListener('load', onLoad);

async function requestRecentlyIndexed(){
    const data = {};
    data.query = document.getElementById("search-input").value;
    data.session_token = localStorage.get("session");
    try {
        const res = await fetch('search/recent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        return data;
    } catch (e) {
        console.error(e);
    }
    const results = res.json().recently_indexed;
    results.array.forEach(r => {
        addSearchResult(r.doc.title, r.doc.description, r.doc.url);
    });
}

async function search(e){
    e.preventDefault();
    const data = {};
    data.query = document.getElementById("search-input").value;
    data.session_token = localStorage.getItem("session");
    try {
        const res = await fetch('search/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        const results = data.search_results;
        results.forEach(r => {
            addSearchResult(r.doc.title, r.doc.description, r.doc.url);
        });
    } catch (e) {
        console.error(e);
    }
}

function addSearchResult(title, description, url){
    const resultsElement = document.getElementById("search-results");
    const result = document.createElement("div");
    result.className = "search-result";

    const resultHeader = document.createElement('div');
    resultHeader.className = "result-header";
    resultHeader.innerText = title;

    const resultDescription = document.createElement('div');
    resultDescription.className = "result-description";
    resultDescription.innerText = description;

    result.replaceChildren(resultHeader, resultDescription);
    result.addEventListener('click', window.open(url, '_blank').focus());
    resultsElement.appendChild(result);
}

function addRecentlyIndexedPages(){

}

function onLoad(){
    document.getElementById('search-form').addEventListener('submit', search);
}