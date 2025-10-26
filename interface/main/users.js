import { user_id as current_user_id } from "/main/persistent.js";
import { requestToggleBanUser, requestToggleAdminUser, requestToggleRestrictUser } from "/main/requests.js";

function createUserSidebarDiv(user){
    let settingsHTML = ``;
    if (user.admin){
        settingsHTML = `
            <div id="ban-user" class="user-setting btn">Ban</div>
            <div id="restrict-user" class="user-setting btn">Restrict</div>
            <div id="admin-user" class="user-setting btn">Make Admin</div>
            <div id="rename-user" class="user-setting btn">Rename</div>
            <div id="delete-pfp-user" class="user-setting btn">Delete pfp</div>`
    } else if (user.id == current_user_id){
        settingsHTML = `
            <div id="rename-user" class="user-setting btn">Rename</div>
            <div id="delete-pfp-user" class="user-setting btn">Delete pfp</div>`
    }
    const userHTML = `
        <div id="user-${user.id}" class="sidebar-item" data-id="${user.id}">
            <div style="display: flex;">
                <img src="/images/users/${user.id}.webp" style="width:25px;height:25px; margin-top:auto;margin-bottom:auto;margin-right:10px">
                <div id="user-${user.id}-name" style="margin-top: auto; margin-bottom: auto;">
                    ${user.username}
                </div>
                <div id="user-${user.id}-activity" class="user-activity" style="margin-left: auto; padding: 8px;">
                    ${user.active ? "🟢" : "🔴"}
                </div>
            </div>
            <div id="user-${user.id}-settings" class="user-settings">
                ${settingsHTML}
            </div>
        </div>`;
    return userHTML;
}

function setSettingsListeners(userDiv) {
    const user_id = userDiv.dataset.id;
    const settingsDiv = userDiv.querySelector(`.user-settings`);
    settingsDiv.querySelectorAll('.user-setting').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleUserAction(user_id, btn.dataset.action);
            settingsDiv.style.display = "none";
        });
    });
}

function handleUserAction(user_id, action) {
    const actions = {
        'ban': () => requestToggleBanUser(user_id),
        'restrict': () => requestToggleRestrictUser(user_id),
        'admin': () => requestToggleAdminUser(user_id),
        'rename': () => console.log(`Rename user: ${user_id}`),
        'delete-pfp': () => requestResetUserPfp(user_id)
    };
    
    if (actions[action]) {
        actions[action]();
    }
}

export function loadUsers(users){
    const userSidebarDivs = users.map(createUserSidebarDiv);
    const rightSidebar = document.getElementById('sidebar-r');
    rightSidebar.innerHTML += userSidebarDivs.join('');
    rightSidebar.querySelectorAll(".sidebar-item").forEach(el => {
        el.addEventListener('click', onClickUser);
        setSettingsListeners(el);
    });
}

export function setActivity(user_id, active){
    document.getElementById(`user-${user_id}-activity`).innerHTML = active ? "🟢" : "🔴";
}

function onClickUser(event) {
    const userElement = event.target.closest('.sidebar-item');
    const user_id = userElement ? userElement.dataset.id : null;
    if (!user_id) return;

    const settingsDiv = userElement.querySelector('.user-settings');
    if (!settingsDiv) return;
    document.getElementById('sidebar-r').querySelectorAll(`user-settings`).forEach(el =>el.style.display = "none");
    if (settingsDiv.style.display === "none" || !settingsDiv.style.display){
        settingsDiv.style.display = "block";
    } else {
        settingsDiv.style.display = "none";
    }
}
