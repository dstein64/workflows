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

const set_token_visibility = function() {
    let type = 'password';
    if (document.getElementById('show').checked)
        type = 'text';
    document.getElementById('token').type = type;
};

// Initialize token visibility
set_token_visibility();

document.getElementById('show').addEventListener('change', function(e) {
    set_token_visibility();
});

const show_progress = function() {
    document.getElementById('progress').style.visibility = 'visible';
};

const hide_progress = function() {
    document.getElementById('progress').style.visibility = 'hidden';
};

// *************************************************
// * Utils
// *************************************************

const PriorityQueue = function() {
    const array = [];
    let count = 0;  // reflects the number of total pushes, not the current size

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

    this.push = function(data, priority=0) {
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
// * API Agent
// *************************************************

// An API agent is used as a way to throttle API calls, with the goal of preventing/reducing:
//   > 403: You have triggered an abuse detection mechanism.
//     Please wait a few minutes before you try again.
//   > Chrome: net::ERR_INSUFFICIENT_RESOURCES

//  Observed error responses
// --------------------------
// 401 observed example
//   {
//      "message": "Bad credentials",
//      "documentation_url": "https://docs.github.com/rest"
//   }
// 401 observed example
//   {
//      "message": "Requires authentication",
//      "documentation_url":
//        "https://docs.github.com/rest/reference/users#get-the-authenticated-user"
//   }
// 403 observed example
//   {
//      "message": "API rate limit exceeded for <IP_ADDRESS>. (But here's the good news:
//      Authenticated requests get a higher rate limit. Check out the documentation for more
//      details.)",
//      "documentation_url": "https://developer.github.com/v3/#rate-limiting"
//   }
// 403 observed example
//   {
//      "message": "You have triggered an abuse detection mechanism. Please wait a few
//         minutes before you try again.",
//      "documentation_url": "https://developer.github.com/v3/#abuse-rate-limits"
//   }
// 404 observed example
//   {
//      "message": "Not Found",
//      "documentation_url":
//        "https://docs.github.com/rest/reference/repos#list-repositories-for-a-user"
//   }

const ApiAgent = function(auth=null, connections_limit=1) {
    const API = 'https://api.github.com';
    // Responses with these codes are assumed to return a JSON object with a 'message'
    // and 'documentation_url' (see examples above).
    const ERROR_CODES = [401, 403, 404];

    let num_connections = 0;
    const pending = new PriorityQueue();
    let active = true;

    const deactivate = () => {
        active = false;
        hide_progress();
    };

    const request = (endpoint, callback=null) => {
        if (!endpoint.startsWith('/')) {
            throw `invalid endpoint: ${endpoint}`;
        }
        show_progress();
        num_connections += 1;
        const xhttp = new XMLHttpRequest();
        xhttp.onreadystatechange = function() {
            if (this.readyState === 4) {
                num_connections -= 1;
                if (active && this.status === 200 && callback != null) {
                    const response = JSON.parse(this.responseText);
                    callback(response);
                } else if (active && this.status >= 400) {
                    deactivate();
                    console.error(this.status + '\n' + this.responseText);
                    let message = `${this.status} Error`;
                    if (ERROR_CODES.includes(this.status)) {
                        try {
                            const response = JSON.parse(this.responseText);
                            message += '\n\nHere\'s more information from GitHub:\n';
                            message += `${response.message}\n${response.documentation_url}`;
                        } catch {}
                    }
                    alert(message);
                }
                if (active && pending.length() > 0) {
                    if (num_connections < connections_limit) {
                        const {endpoint, callback} = pending.pop();
                        request(endpoint, callback);
                    }
                } else if (num_connections === 0) {
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

    this.submit = (endpoint, callback=null, priority=DEFAULT_PRIORITY) => {
        pending.push({endpoint: endpoint, callback: callback}, priority);
        if (active && num_connections < connections_limit) {
            const popped = pending.pop();
            request(popped.endpoint, popped.callback);
        }
    };

    this.deactivate = () => {
        deactivate();
    };
};

// *************************************************
// * Main
// *************************************************

// Do not set PER_PAGE above 100. That's the max permitted value, and the code below
// assumes there are no more items remaining if the total items returned is less
// than the 'per_page' value specified.
const PER_PAGE = 100;

const AUTHENTICATED_USER_PRIORITY = 4;
const RUN_PRIORITY = 3;
const WORKFLOWS_PRIORITY = 2;
const REPOS_PRIORITY = 1;

const EM_DASH_CHAR = '\u2014';
const NBSP_CHAR = '\u00a0';
const INFO_CHAR = '\u24d8';
const MULTIPLY_CHAR = '\u00d7';

const Controller = function(connections_limit, token=null) {
    let auth = null;
    if (token !== null)
        auth = 'token ' + token;
    const api_agent = new ApiAgent(auth, connections_limit);

    const process_repos = function(user, _public=true, callback=null, page=1) {
        const request_callback = function(repos) {
            // The top level response is an array with items, unlike the other API calls that
            // return a dictionary with 'total_count' along with an array of items.
            if (callback !== null) {
                for (const repo of repos) {
                    callback(repo);
                }
            }
            if (repos.length === PER_PAGE) {
                process_repos(user, _public, callback, page + 1);
            }
        };
        const params = new URLSearchParams({
            page: page,
            per_page: PER_PAGE,
        });
        let endpoint = `/users/${user}/repos?` + params.toString();
        if (!_public)
            endpoint = `/user/repos?` + params.toString();
        api_agent.submit(endpoint, request_callback, REPOS_PRIORITY);
    };

    const process_workflows = function(repo, callback=null, page=1, count=0) {
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
                process_workflows(repo, callback, page + 1, count);
            }
        };
        const params = new URLSearchParams({
            page: page,
            per_page: PER_PAGE,
        });
        const endpoint = `/repos/${repo}/actions/workflows?` + params.toString();
        api_agent.submit(endpoint, request_callback, WORKFLOWS_PRIORITY);
    };

    const process_run = function(repo, workflow_id, branch=null, callback=null) {
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
        const endpoint = `/repos/${repo}/actions/workflows/${workflow_id}/runs?` + params.toString();
        api_agent.submit(endpoint, request_callback, RUN_PRIORITY);
    };

    const process_authenticated_user = function(callback=null) {
        const request_callback = function(user) {
            if (callback !== null) {
                callback(user);
            }
        };
        const endpoint = '/user';
        api_agent.submit(endpoint, request_callback, AUTHENTICATED_USER_PRIORITY);
    };

    // This function assumes existing results have already been removed.
    const init_results = (user, authenticated=false) => {
        const results = document.getElementById('results');
        const user_container = document.createElement('div');
        results.appendChild(user_container);
        const h3 = document.createElement('h3');
        h3.id = 'username';
        user_container.appendChild(h3);
        const anchor = document.createElement('a');
        h3.appendChild(anchor);
        anchor.textContent = user;
        anchor.href = `https://github.com/${user}`;

        if (authenticated) {
            user_container.appendChild(document.createTextNode(NBSP_CHAR));
            const span = document.createElement('span');
            user_container.appendChild(span);
            span.classList.add('label');
            span.textContent = 'Authenticated';
        }

        const table = document.createElement('table');
        results.appendChild(table);
        const thead = document.createElement('thead');
        table.appendChild(thead);
        const tr = document.createElement('tr');
        thead.appendChild(tr);
        const columns = ['', 'repository', 'workflow', 'state', 'run', 'status', 'conclusion'];
        for (const column of columns) {
            const th = document.createElement('th');
            th.textContent = column;
            tr.appendChild(th);
        }
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        return results;
    };

    // Returns the index in the table for inserting a new row, such that alphabetic ordering
    // is maintained.
    const get_idx = (tbody, repo, workflow) => {
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

    const create_dialog = (content) => {
        const dialog = document.createElement('dialog');
        const dialog_close = document.createElement('span');
        dialog_close.textContent = MULTIPLY_CHAR;
        dialog_close.classList.add('close');
        dialog_close.addEventListener('click', () => {
            dialog.close();
        });
        dialog.appendChild(dialog_close);
        dialog.addEventListener('click', (e) => {
            const rect = dialog.getBoundingClientRect();
            const overlap =
                rect.top <= e.clientY
                    && rect.top + rect.height >= e.clientY
                    && rect.left <= e.clientX
                    && rect.left + rect.width >= e.clientX;
            if (!overlap)
                dialog.close();
        });
        const wrapper = document.createElement('div');
        wrapper.id = 'dialog-wrapper';
        wrapper.appendChild(content);
        dialog.appendChild(wrapper);
        return dialog;
    };

    const process = (user=null, default_branch=true, _public=true) => {
        // New DOM elements are created to populate #results. This prevents prior submissions
        // from clobbering a new submission. This was done as a precaution, as the deactivation
        // of the API agent in this.deactivate should be sufficient to prevent this from happening.
        const results = init_results(user, !_public);
        const tbody = results.querySelector('table tbody');
        process_repos(user, _public, (repo) => {
            const workflow_callback = (workflow) => {
                const name = repo.owner.login === user ? repo.name : repo.full_name;

                const tr = document.createElement('tr');
                tr.setAttribute('data-repo', name);
                tr.setAttribute('data-workflow', workflow.name);
                let idx = get_idx(tbody, name, workflow.name);
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
                repo_anchor.textContent = name;
                repo_td.appendChild(repo_anchor);
                let repo_label = null;
                if (repo.private && repo.archived) {
                    repo_label = `Private${NBSP_CHAR}archived`;
                } else if (repo.private) {
                    repo_label = 'Private';
                } else if (repo.archived) {
                    repo_label = 'Archived';
                }
                if (repo_label !== null) {
                    repo_td.appendChild(document.createTextNode(NBSP_CHAR));
                    const span = document.createElement('span');
                    repo_td.appendChild(span);
                    span.classList.add('label');
                    span.textContent = repo_label;
                }

                const workflow_td = document.createElement('td');
                tr.appendChild(workflow_td);
                const workflow_anchor = document.createElement('a');
                workflow_anchor.href =
                    `https://github.com/${repo.full_name}/actions/workflows/${workflow.name}.yml`;
                workflow_anchor.textContent = workflow.name;
                workflow_td.appendChild(workflow_anchor);
                workflow_td.appendChild(document.createTextNode(NBSP_CHAR));
                const workflow_info_div = document.createElement('div');
                const workflow_info_h4 = document.createElement('h4');
                workflow_info_h4.textContent = `workflow info`;
                workflow_info_h4.appendChild(document.createElement('br'));
                workflow_info_h4.appendChild(document.createElement('br'));
                workflow_info_h4.appendChild(document.createTextNode(`repository: ${name}`));
                workflow_info_h4.appendChild(document.createElement('br'));
                workflow_info_h4.appendChild(document.createTextNode(`workflow: ${workflow.name}`));
                const workflow_info_pre = document.createElement('pre');
                workflow_info_pre.textContent = JSON.stringify(workflow, null, 2);
                workflow_info_div.appendChild(workflow_info_h4);
                workflow_info_div.appendChild(workflow_info_pre);
                const workflow_info_dialog = create_dialog(workflow_info_div);
                workflow_td.appendChild(workflow_info_dialog);
                const workflow_info_span = document.createElement('span');
                workflow_info_span.classList.add('info');
                workflow_info_span.textContent = INFO_CHAR;
                workflow_info_span.addEventListener('click', (event) => {
                    workflow_info_dialog.showModal();
                });
                workflow_td.appendChild(workflow_info_span);

                const state_td = document.createElement('td');
                tr.appendChild(state_td);
                if (workflow.state !== null) {
                    // Observed states: 'active', 'disabled_manually', 'disabled_inactivity'
                    const state_span = document.createElement('span');
                    state_span.dataset.state = workflow.state;
                    state_span.textContent = workflow.state;
                    state_td.appendChild(state_span);
                } else {
                    state_td.textContent = EM_DASH_CHAR;
                }

                const run_callback = (run) => {
                    const run_td = document.createElement('td');
                    tr.appendChild(run_td);
                    if (run !== null) {
                        const run_anchor = document.createElement('a');
                        run_anchor.href = run.html_url;
                        run_anchor.textContent = run.id;
                        run_td.appendChild(run_anchor);
                        run_td.appendChild(document.createTextNode(NBSP_CHAR));
                        const run_info_div = document.createElement('div');
                        const run_info_h4 = document.createElement('h4');
                        run_info_h4.textContent = `run info`;
                        run_info_h4.appendChild(document.createElement('br'));
                        run_info_h4.appendChild(document.createElement('br'));
                        run_info_h4.appendChild(document.createTextNode(`repository: ${name}`));
                        run_info_h4.appendChild(document.createElement('br'));
                        run_info_h4.appendChild(document.createTextNode(`workflow: ${workflow.name}`));
                        run_info_h4.appendChild(document.createElement('br'));
                        run_info_h4.appendChild(document.createTextNode(`run: ${run.id}`));
                        const run_info_pre = document.createElement('pre');
                        run_info_pre.textContent = JSON.stringify(run, null, 2);
                        run_info_div.appendChild(run_info_h4);
                        run_info_div.appendChild(run_info_pre);
                        const run_info_dialog = create_dialog(run_info_div);
                        run_td.appendChild(run_info_dialog);
                        const run_info_span = document.createElement('span');
                        run_info_span.classList.add('info');
                        run_info_span.textContent = INFO_CHAR;
                        run_info_span.addEventListener('click', (event) => {
                            run_info_dialog.showModal();
                        });
                        run_td.appendChild(run_info_span);
                    } else {
                        run_td.textContent = EM_DASH_CHAR;
                    }

                    const status_td = document.createElement('td');
                    tr.appendChild(status_td);
                    if (run !== null && run.status !== null) {
                        // Observed statuses: 'queued', 'in_progress', 'completed'
                        const status_span = document.createElement('span');
                        status_span.dataset.status = run.status;
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
                        conclusion_span.dataset.conclusion = run.conclusion;
                        conclusion_span.textContent = run.conclusion;
                        conclusion_td.appendChild(conclusion_span);
                    } else {
                        conclusion_td.textContent = EM_DASH_CHAR;
                    }
                };
                let branch = null;
                if (default_branch)
                    branch = repo.default_branch;
                process_run(repo.full_name, workflow.id, branch, run_callback);
            };
            process_workflows(repo.full_name, workflow_callback);
        });
    };

    this.process = (user=null, default_branch=true) => {
        if (document.getElementById('results').firstChild !== null)
            throw '#results should be empty';
        if (user === null) {
            process_authenticated_user((user) => {
                process(user.login, default_branch, false);
            });
        } else {
            process(user, default_branch, true);
        }
    };

    this.deactivate = () => {
        // Deactivating the API agent is sufficient to deactivate the controller, since
        // this will stop the registered callbacks from executing.
        api_agent.deactivate();
    };
};

{
    let controller = null;

    document.getElementById('options_form').addEventListener('submit', function(event) {
        event.preventDefault();
        event.stopPropagation();
        // Remove existing results
        const results = document.getElementById('results');
        while (results.lastChild) {
            results.removeChild(results.lastChild);
        }
        if (controller !== null)
            controller.deactivate();
        let token = document.getElementById('token').value;
        if (token.length === 0)
            token = null;
        const connections_limit = parseInt(document.getElementById('connections').value);
        let user = document.getElementById('user').value;
        if (user.length === 0)
            user = null;
        if (token === null && user === null) {
            alert('A token or a user is required.');
            return;
        }
        const default_branch = document.getElementById('default_branch').checked;
        controller = new Controller(connections_limit, token);
        controller.process(user, default_branch);
    });

    document.getElementById('cancel_button').addEventListener('click', function(event) {
        event.preventDefault();
        event.stopPropagation();
        if (controller !== null)
            controller.deactivate();
    });
}
