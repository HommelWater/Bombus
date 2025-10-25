import { users } from "/main/persistent.js";
import { requestToggleBanUser, requestToggleAdminUser, requestToggleRestrictUser } from "/main/requests.js";

function createUserSidebarDiv(user){
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
        </div>`;
    return userHTML;
}

export function loadUsers(users){
    const userSidebarDivs = users.map(createUserSidebarDiv);
    const rightSidebar = document.getElementById('sidebar-r');
    rightSidebar.innerHTML += userSidebarDivs.join('');
    document.querySelectorAll(".sidebar-item").forEach(el => el.addEventListener('contextmenu', onRightClickUser));
}

export function setActivity(user_id, active){
    document.getElementById(`user-${user_id}-activity`).innerHTML = active ? "🟢" : "🔴";
}

function onRightClickUser(event){
    const userElement = event.target.closest('.sidebar-item');
    const user_id = userElement ? userElement.dataset.id : null;
    if (!user_id) {
        console.error('User ID not found');
        return;
    }
    event.preventDefault();

    const user = users[user_id];
    const settingsHTML = createUserSettingsDiv(user);
    const settingsDiv = document.getElementById("rclick-settings");
    settingsDiv.innerHTML = settingsHTML;
    
    settingsDiv.style.left = `${event.pageX}px`;
    settingsDiv.style.top = `${event.pageY}px`;
    
    const banUser = settingsDiv.querySelector('#ban-user');
    const restrictUser = settingsDiv.querySelector('#restrict-user');
    const adminUser = settingsDiv.querySelector('#admin-user');
    const renameUser = settingsDiv.querySelector('#rename-user');
    const deletePfpUser = settingsDiv.querySelector('#delete-pfp-user');
    
    banUser.addEventListener('click', () => {
        requestToggleBanUser(user_id);
        settingsDiv.style.display = "none";
    });
    
    restrictUser.addEventListener('click', () => {
        console.log(`Restrict user: ${user.id}`);
        requestToggleRestrictUser(user_id);
        settingsDiv.style.display = "none";
    });

    adminUser.addEventListener('click', () => {
        console.log(`Admin user: ${user.id}`);
        requestToggleAdminUser(user_id);
        settingsDiv.style.display = "none";
    });
    
    renameUser.addEventListener('click', () => {
        console.log(`Rename user: ${user.id}`);
        settingsDiv.style.display = "none";
    });
    
    deletePfpUser.addEventListener('click', () => {
        console.log(`Delete profile picture for user: ${user.id}`);
        settingsDiv.style.display = "none";
    });
    
    settingsDiv.style.display = "block";
    
    const closeMenu = (e) => {
        if (!settingsDiv.contains(e.target)) {
            settingsDiv.style.display = "none";
            document.removeEventListener('click', closeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', closeMenu);
    }, 10);
}

function createUserSettingsDiv(user){
    const settingsHTML = `
        <div id="user-${user.id}-settings" class="rclick-settings ">
            <div id="ban-user" class="user-setting btn">Ban</div>
            <div id="restrict-user" class="user-setting btn">Restrict</div>
            <div id="rename-user" class="user-setting btn">Rename</div>
            <div id="delete-pfp-user" class="user-setting btn">Delete pfp</div>
        </div>
    `;
    return settingsHTML;
}

