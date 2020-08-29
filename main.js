// Do not set this above 100. That's the max permitted value, and the code below
// assumes there are no more items remaining if the total items returned is less
// than the 'per_page' value specified.
const PER_PAGE = 100;

const get_repos = function(user, auth=null, callback=null, page=1, repos=[]) {
    const xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
            // The top level response is an array with items, unlike the other API calls that
            // return a dictionary with 'total_count' along with an array of items.
            const _repos = JSON.parse(xhttp.responseText);
            repos = repos.concat(_repos);
            if (_repos.length < PER_PAGE) {
                if (callback !== null) callback(repos);
            } else {
                get_repos(user, auth, callback, page + 1, repos);
            }
        }
    };
    const params = new URLSearchParams({
        page: page,
        per_page: PER_PAGE,
    });
    const url = `https://api.github.com/users/${user}/repos?` + params.toString();
    xhttp.open('GET', url);
    xhttp.setRequestHeader('Accept', 'application/vnd.github.v3+json');
    console.log(auth);
    if (auth !== null)
        xhttp.setRequestHeader('Authorization', auth);
    xhttp.send();
};

const get_workflows = function(user, repo, auth=null, callback=null, page=1, workflows=[]) {
    const xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
            const response = JSON.parse(xhttp.responseText);
            const total_count = response.total_count;
            const _workflows = response.workflows;
            workflows = workflows.concat(_workflows);
            if (_workflows.length < PER_PAGE || workflows.length >= total_count) {
                if (callback !== null) callback(workflows);
            } else {
                get_workflows(user, repo, auth, callback, page + 1, workflows);
            }
        }
    };
    const params = new URLSearchParams({
        page: page,
        per_page: PER_PAGE,
    });
    const url = `https://api.github.com/repos/${user}/${repo}/actions/workflows?` + params.toString();
    xhttp.open('GET', url);
    xhttp.setRequestHeader('Accept', 'application/vnd.github.v3+json');
    if (auth !== null)
        xhttp.setRequestHeader('Authorization', auth);
    xhttp.send();
};

const get_run = function(user, repo, workflow_id, auth=null, callback=null) {
    const xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
        if (this.readyState === 4 && this.status === 200) {
            const response = JSON.parse(xhttp.responseText);
            if (response.total_count > 0 && response.workflow_runs.length >= 1) {
                if (callback !== null) callback(response.workflow_runs[0]);
            }
        }
    };
    const url = `https://api.github.com/repos/${user}/${repo}/actions/workflows/${workflow_id}/runs?per_page=1`;
    xhttp.open('GET', url);
    xhttp.setRequestHeader('Accept', 'application/vnd.github.v3+json');
    if (auth !== null)
        xhttp.setRequestHeader('Authorization', auth);
    xhttp.send();
};

// Returns the index in the table for inserting a new row, such that alphabetic ordering
// is maintained.
const get_idx = function(repo) {
    const tbody = document.getElementById('tbody');
    let idx = 0;
    // TODO: use binary search.
    for (const tr of tbody.children) {
        const _repo = tr.getAttribute('data-repo');
        if (_repo.toLowerCase() > repo.toLowerCase()) break;
        ++idx;
    }
    return idx;
};

const user = 'dstein64';
const auth = null;
get_repos(user, auth, (repos) => {
    for (const repo of repos) {
        const process_workflows = (workflows) => {
            let idx = get_idx(repo.name);
            for (const workflow of workflows) {
                const tbody = document.getElementById('tbody');
                const tr = document.createElement('tr');
                tr.setAttribute('data-repo', repo.name);
                tr.setAttribute('data-workflow', workflow.name);
                if (idx === 0) {
                    tbody.insertBefore(tr, tbody.firstElementChild);
                } else {
                    tbody.children[idx - 1].after(tr);
                }
                ++idx;

                const repo_td = document.createElement('td');
                tr.appendChild(repo_td);
                const repo_anchor = document.createElement('a');
                repo_anchor.href = repo.html_url;
                repo_anchor.textContent = repo.name;
                repo_td.appendChild(repo_anchor);

                const workflow_td = document.createElement('td');
                tr.appendChild(workflow_td);
                const workflow_anchor = document.createElement('a');
                const workflow_qs = new URLSearchParams(
                    {'query': 'workflow:"' + workflow.name + '"'}).toString();
                workflow_anchor.href = `https://github.com/${user}/${repo.name}/actions?` + workflow_qs;
                workflow_anchor.textContent = workflow.name;
                workflow_td.appendChild(workflow_anchor);

                const badge_td = document.createElement('td');
                tr.appendChild(badge_td);
                const badge_img = document.createElement('img');
                // Add a query string param, to prevent using a cached image.
                badge_img.src = workflow.badge_url + '?_=' + String(new Date().getTime());
                badge_td.appendChild(badge_img);

                const process_run = (run) => {
                    const run_td = document.createElement('td');
                    tr.appendChild(run_td);
                    const run_anchor = document.createElement('a');
                    run_anchor.href = run.html_url;
                    run_anchor.textContent = run.id;
                    run_td.appendChild(run_anchor);

                    const status_td = document.createElement('td');
                    tr.appendChild(status_td);
                    // Observed statuses: 'queued', 'in_progress', 'completed'
                    if (run.status !== null) {
                        const status_span = document.createElement('span');
                        status_span.classList.add(run.status);
                        status_span.textContent = run.status;
                        status_td.appendChild(status_span);
                    }

                    const conclusion_td = document.createElement('td');
                    tr.appendChild(conclusion_td);
                    // Observed conclusions: 'success', 'failure', 'cancelled', null
                    // 'canceled' was paired with 'completed' status.
                    // null was paired with 'queued' and 'in_progress' statuses.
                    if (run.conclusion !== null) {
                        const conclusion_span = document.createElement('span');
                        conclusion_span.classList.add(run.conclusion);
                        conclusion_span.textContent = run.conclusion;
                        conclusion_td.appendChild(conclusion_span);
                    }
                };
                get_run(user, repo.name, workflow.id, auth, process_run);
            }
        };
        get_workflows(user, repo.name, auth, process_workflows);
    }
});
