const form = document.getElementById("setup-form");
const status = document.getElementById("status");
const button = document.getElementById("save");
const params = new URLSearchParams(window.location.search);
document.getElementById("email").value = params.get("email") || "";

form.addEventListener("submit", async event => {
  event.preventDefault();
  status.textContent = "";
  button.disabled = true;
  button.textContent = "Encrypting credentials…";
  try {
    const result = await window.mayaSetup.saveConfig({
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
      apiKey: document.getElementById("apiKey").value
    });
    if (result.saved) {
      status.className = "success";
      status.textContent = "Credentials encrypted. Starting Maya…";
      window.close();
    }
  } catch (error) {
    status.className = "error";
    status.textContent = error.message || "Could not save the configuration.";
    button.disabled = false;
    button.textContent = "Save securely and launch Maya";
  }
});
