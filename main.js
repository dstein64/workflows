// *************************************************
// * Layout/Style
// *************************************************

// Position the forkme image offscreen when scrolling down. This lets it effectively
// have fixed positioning horizontally (always rightmost aligned to window when visible,
// including when scrolling right) and absolute positioning vertically (always at the top
// of the page, even when scrolling down).
window.addEventListener('scroll', function() {
    const forkme = document.getElementById('forkme');
    const offset = Math.min(forkme.offsetHeight, window.pageYOffset);
    forkme.style.top = `-${offset}px`;
});

const show_progress = function() {
    document.getElementById('progress').style.display = 'inline';
};

const hide_progress = function() {
    document.getElementById('progress').style.display = 'none';
};

// *************************************************
// * Utils
// *************************************************

const PriorityQueue = function() {
    const array = [];
    let count = 0;  // tracks the number of total pushes, not the current size

    // Compare priority values, breaking ties based on insertion order.
    // Returns 1 if a > b, 0 if a == b, and -1 if a < b.
    const compare = function(a, b) {
        if (a.value > b.value)
            return 1;
        if (a.value < b.value)
            return -1;
        if (a.count < b.count)
            return 1;
        if (a.count > b.count)
            return -1;
        throw 'inputs had matching counts, which should be unique'
    };

    this.push = function(data, priority=DEFAULT_PRIORITY) {
        // Reheapification upward
        priority = {value: priority, count: ++count};
        let idx = array.length;
        array.push({data: data, priority: priority});
        while (idx > 0) {
            const pidx = (idx - 1) >> 1;  // parent index
            if (compare(priority, array[pidx].priority) > 0) {
                const tmp = array[pidx];
                array[pidx] = array[idx];
                array[idx] = tmp;
                idx = pidx;
            } else {
                break;
            }
        }
    };

    this.pop = function() {
        // Reheapification downward
        if (array.length === 0) {
            throw 'queue is empty';
        }
        const root = array[0].data;
        const popped = array.pop();
        if (array.length > 0) {
            array[0] = popped;
            let idx = 0;
            while (idx < array.length) {
                const lidx = 2 * idx + 1;  // left child index
                if (lidx >= array.length)
                    break;
                const ridx = lidx + 1;  // right child index
                let cidx = lidx;  // candidate index for swapping
                if (ridx < array.length && compare(array[ridx].priority, array[lidx].priority) > 0)
                    cidx = ridx;
                if (compare(array[cidx].priority, array[idx].priority) > 0) {
                    const tmp = array[cidx];
                    array[cidx] = array[idx];
                    array[idx] = tmp;
                    idx = cidx;
                } else {
                    break;
                }
            }
        }
        return root;
    };

    this.length = function() {
        return array.length;
    };
};

// *************************************************
// * Main
// *************************************************

// Do not set PER_PAGE above 100. That's the max permitted value, and the code below
// assumes there are no more items remaining if the total items returned is less
// than the 'per_page' value specified.
const PER_PAGE = 100;

const DEFAULT_PRIORITY = 0;
const RUN_PRIORITY = 3;
const WORKFLOWS_PRIORITY = 2;
const REPOS_PRIORITY = 1;

const EM_DASH_CHAR = '\u2014';

// An API agent is used as a way to throttle API calls, with the goal of preventing/reducing:
//   > 403: You have triggered an abuse detection mechanism.
//     Please wait a few minutes before you try again.
//   > Chrome: net::ERR_INSUFFICIENT_RESOURCES
const ApiAgent = function(auth=null) {
    const API = 'https://api.github.com';

    const CONNECTIONS_LIMIT = 1;
    let num_connections = 0;
    const pending = new PriorityQueue();
    let active = true;

    const request = function(endpoint, callback=null) {
        if (!endpoint.startsWith('/')) {
            throw `invalid endpoint: ${endpoint}`;
        }
        show_progress();
        num_connections += 1;
        const xhttp = new XMLHttpRequest();
        xhttp.onreadystatechange = function() {
            if (this.readyState === 4) {
                num_connections -= 1;
                if (this.status === 200 && callback != null) {
                    const response = JSON.parse(this.responseText);
                    callback(response);
                } else if (active && [401, 403].includes(this.status)) {
                    // 401 observed example
                    //   {
                    //      "message": "Bad credentials",
                    //      "documentation_url": "https://docs.github.com/rest"
                    //   }
                    // 403 observed example
                    //   {
                    //      "message": "API rate limit exceeded for 67.163.151.50. (But here's the good
                    //         news: Authenticated requests get a higher rate limit. Check out the documentation
                    //         for more details.)",
                    //      "documentation_url": "https://developer.github.com/v3/#rate-limiting"
                    //   }
                    // 403 observed example
                    //   {
                    //      "message": "You have triggered an abuse detection mechanism. Please wait a few
                    //         minutes before you try again.",
                    //      "documentation_url": "https://developer.github.com/v3/#abuse-rate-limits"
                    //   }
                    active = false;
                    console.error(this.status + '\n' + this.responseText);
                    const response = JSON.parse(this.responseText);
                    let message = `${this.status} Error\n\n`;
                    message += 'Here\'s more information from GitHub:\n';
                    message += `${response.message}\n${response.documentation_url}`;
                    hide_progress();
                    alert(message);
                }
                if (active && pending.length() > 0) {
                    if (num_connections < CONNECTIONS_LIMIT) {
                        const {endpoint, callback} = pending.pop();
                        request(endpoint, callback);
                    }
                } else {
                    // This can occur multiple times
                    hide_progress();
                }
            }
        };
        const url = `${API}${endpoint}`;
        xhttp.open('GET', url);
        xhttp.setRequestHeader('Accept', 'application/vnd.github.v3+json');
        if (auth !== null)
            xhttp.setRequestHeader('Authorization', auth);
        xhttp.send();
    };

    this.submit = function(endpoint, callback=null, priority=DEFAULT_PRIORITY) {
        pending.push({endpoint: endpoint, callback: callback}, priority);
        if (active && num_connections < CONNECTIONS_LIMIT) {
            const popped = pending.pop();
            request(popped.endpoint, popped.callback);
        }
    };
};

const API_AGENT = new ApiAgent(null);

const process_repos = function(user, callback=null, page=1) {
    const request_callback = function(repos) {
        // The top level response is an array with items, unlike the other API calls that
        // return a dictionary with 'total_count' along with an array of items.
        if (callback !== null) {
            for (const repo of repos) {
                callback(repo);
            }
        }
        if (repos.length === PER_PAGE) {
            process_repos(user, callback, page + 1);
        }
    };
    const params = new URLSearchParams({
        page: page,
        per_page: PER_PAGE,
    });
    const endpoint = `/users/${user}/repos?` + params.toString();
    API_AGENT.submit(endpoint, request_callback, REPOS_PRIORITY);
};

const process_workflows = function(user, repo, callback=null, page=1, count=0) {
    const request_callback = function(response) {
        const total_count = response.total_count;
        const workflows = response.workflows;
        count += workflows.length;
        if (callback !== null) {
            for (const workflow of workflows) {
                callback(workflow);
            }
        }
        if (count < total_count) {
            process_workflows(user, repo, callback, page + 1, count);
        }
    };
    const params = new URLSearchParams({
        page: page,
        per_page: PER_PAGE,
    });
    const endpoint = `/repos/${user}/${repo}/actions/workflows?` + params.toString();
    API_AGENT.submit(endpoint, request_callback, WORKFLOWS_PRIORITY);
};

const process_run = function(user, repo, workflow_id, branch=null, callback=null) {
    const request_callback = function(response) {
        if (callback !== null) {
            let run = null;
            if (response.total_count > 0 && response.workflow_runs.length >= 1) {
                run = response.workflow_runs[0];
            }
            callback(run);
        }
    };
    const params = new URLSearchParams({
        per_page: 1,
    });
    if (branch !== null) {
        params.append('branch', branch);
    }
    const endpoint = `/repos/${user}/${repo}/actions/workflows/${workflow_id}/runs?` + params.toString();
    API_AGENT.submit(endpoint, request_callback, RUN_PRIORITY);
};

// Returns the index in the table for inserting a new row, such that alphabetic ordering
// is maintained.
const get_idx = function(repo, workflow) {
    const tbody = document.getElementById('tbody');
    const key = repo.toLowerCase() + ' ' + workflow.toLowerCase();
    let lo = 0;
    let hi = tbody.children.length;
    let idx = 0;
    while (hi > lo) {
        let mid = lo + ((hi - lo) >> 1);
        let _repo = tbody.children[mid].getAttribute('data-repo').toLowerCase();
        let _workflow = tbody.children[mid].getAttribute('data-workflow').toLowerCase();
        let _key = _repo + ' ' + _workflow;
        if (_key < key) {
            idx = lo = mid + 1;
        } else if (_key > key) {
            idx = hi = mid;
        } else {
            idx = lo = mid + 1;
        }
    }
    return idx;
};

const user = 'dstein64';
process_repos(user, (repo) => {
    const workflow_callback = (workflow) => {
        const tbody = document.getElementById('tbody');
        const tr = document.createElement('tr');
        tr.setAttribute('data-repo', repo.name);
        tr.setAttribute('data-workflow', workflow.name);
        let idx = get_idx(repo.name, workflow.name);
        if (idx === 0) {
            tbody.insertBefore(tr, tbody.firstElementChild);
        } else {
            tbody.children[idx - 1].after(tr);
        }

        const row_idx_td = document.createElement('td');
        tr.appendChild(row_idx_td);

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
        badge_td.classList.add('badge');
        tr.appendChild(badge_td);
        const badge_img = document.createElement('img');
        // Add a query string param to prevent showing a cached image.
        badge_img.src = workflow.badge_url + '?_=' + String(new Date().getTime());
        badge_td.appendChild(badge_img);

        const run_callback = (run) => {
            const run_td = document.createElement('td');
            tr.appendChild(run_td);
            if (run !== null) {
                const run_anchor = document.createElement('a');
                run_anchor.href = run.html_url;
                run_anchor.textContent = run.id;
                run_td.appendChild(run_anchor);
            } else {
                run_td.textContent = EM_DASH_CHAR;
            }

            const status_td = document.createElement('td');
            tr.appendChild(status_td);
            if (run !== null && run.status !== null) {
                // Observed statuses: 'queued', 'in_progress', 'completed'
                const status_span = document.createElement('span');
                status_span.classList.add(run.status);
                status_span.textContent = run.status;
                status_td.appendChild(status_span);
            } else {
                status_td.textContent = EM_DASH_CHAR;
            }

            const conclusion_td = document.createElement('td');
            tr.appendChild(conclusion_td);
            if (run !== null && run.conclusion !== null) {
                // Observed conclusions: 'success', 'failure', 'cancelled', null
                // 'canceled' was paired with 'completed' status.
                // null was paired with 'queued' and 'in_progress' statuses.
                const conclusion_span = document.createElement('span');
                conclusion_span.classList.add(run.conclusion);
                conclusion_span.textContent = run.conclusion;
                conclusion_td.appendChild(conclusion_span);
            } else {
                conclusion_td.textContent = EM_DASH_CHAR;
            }
        };
        process_run(user, repo.name, workflow.id, repo.default_branch, run_callback);
    };
    process_workflows(user, repo.name, workflow_callback);
});
