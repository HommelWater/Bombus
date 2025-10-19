function createUserSidebarDiv(user){
    const userHTML = `
        <div id="user-${user.id}" class="sidebar-item">
            <div style="display: flex;">
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
}

export function setActivity(user_id, active){
    document.getElementById(`user-${user_id}-activity`).innerHTML = active ? "🟢" : "🔴";
}

function createUserSettingsDiv(user){
    const settingsHTML = `
        <div id="user-${user.id}-settings" class="rclick-settings">
            <div id="ban-user" class="user-setting"></div>
            <div id="restrict-user" class="user-setting"></div>
            <div id="rename-user" class="user-setting"></div>
            <div id="delete-pfp-user" class="user-setting"></div>
        </div>
    `;
    return settingsHTML;
}