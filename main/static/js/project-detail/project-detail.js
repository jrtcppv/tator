class ProjectDetail extends TatorPage {
  constructor() {
    super();

    const main = document.createElement("main");
    main.setAttribute("class", "layout-max py-4");
    this._shadow.appendChild(main);

    const div = document.createElement("div");
    div.setAttribute("class", "py-6");
    main.appendChild(div);

    const header = document.createElement("div");
    header.setAttribute("class", "main__header d-flex flex-justify-between");
    div.appendChild(header);

    const h1 = document.createElement("h1");
    h1.setAttribute("class", "h1");
    header.appendChild(h1);

    this._projectText = document.createTextNode("");
    h1.appendChild(this._projectText);

    const buttons = document.createElement("div");
    buttons.setAttribute("class", "d-flex");
    header.appendChild(buttons);

    this._algorithmButton = document.createElement("algorithm-button");
    buttons.appendChild(this._algorithmButton);

    this._uploadButton = document.createElement("upload-button");
    buttons.appendChild(this._uploadButton);

    this._description = document.createElement("project-text");
    div.appendChild(this._description);

    const subheader = document.createElement("div");
    subheader.setAttribute("class", "d-flex flex-justify-between");
    main.appendChild(subheader);

    this._search = document.createElement("project-search");
    subheader.appendChild(this._search);


    this._collaborators = document.createElement("project-collaborators");
    subheader.appendChild(this._collaborators);

    this._projects = document.createElement("div");
    main.appendChild(this._projects);

    this._newSection = document.createElement("new-section");
    this._projects.appendChild(this._newSection);

    const deleteSection = document.createElement("delete-section-form");
    this._projects.appendChild(deleteSection);

    const deleteFile = document.createElement("delete-file-form");
    this._projects.appendChild(deleteFile);

    this._progress = document.createElement("progress-summary");
    this._shadow.insertBefore(this._progress, main);

    this._leaveConfirmOk = false;

    window.addEventListener("beforeunload", evt => {
      if (this._leaveConfirmOk) {
        evt.preventDefault();
        evt.returnValue = '';
        window.alert("Uploads are in progress. Still leave?");
      }
    });

    this._removeCallback = evt => {
      deleteSection.setAttribute("section-filter", evt.detail.sectionFilter);
      deleteSection.setAttribute("section-name", evt.detail.sectionName);
      deleteSection.setAttribute("project-id", evt.detail.projectId);
      deleteSection.setAttribute("is-open", "");
      this.setAttribute("has-open-modal", "");
      this._updateSectionNames();
    };

    deleteSection.addEventListener("close", evt => {
      this.removeAttribute("has-open-modal", "");
    });

    this._deleteFileCallback = evt => {
      deleteFile.setAttribute("media-id", evt.detail.mediaId);
      deleteFile.setAttribute("media-name", evt.detail.mediaName);
      deleteFile.setAttribute("is-open", "");
      this.setAttribute("has-open-modal", "");
    };

    deleteFile.addEventListener("close", evt => {
      this.removeAttribute("has-open-modal", "");
    });

    this._newAlgorithmCallback = evt => {
      const newAlgorithm = document.createElement("new-algorithm-form");
      this._projects.appendChild(newAlgorithm);
      newAlgorithm.setAttribute("is-open", "");
      this.setAttribute("has-open-modal", "");
      newAlgorithm.addEventListener("close", evt => {
        this.removeAttribute("has-open-modal", "");
        this._projects.removeChild(evt.target);
      });
    };

    this._algorithmButton.addEventListener("newAlgorithm", this._newAlgorithmCallback);

    const updateSection = (section, msg, mediaId) => {
      if (msg.state == "finished") {
        section.updateProgress(msg.uid, mediaId, msg.state, null, msg.message);
        section.removeProcess(msg.uid, mediaId);
        delete msg.uid;
        section.addMedia(msg);
        section.removeMedia(mediaId);
      } else if (msg.state == "queued" || msg.state == "started") {
        if (section.hasProcess(msg.uid, mediaId)) {
          section.updateProgress(msg.uid, mediaId, msg.state, msg.progress, msg.message);
        } else {
          section.addProcess(msg, mediaId);
        }
      } else if (msg.state == "failed") {
        section.updateProgress(msg.uid, mediaId, msg.state, null, msg.message);
      }
    }

    this._progress.addEventListener("uploadProgress", evt => {
      const msg = evt.detail.message;
      if (msg.project_id == this.getAttribute("project-id")) {
        const sections = [...this._shadow.querySelectorAll("media-section")];
        const names = sections.map(elem => elem._sectionName);
        let section;
        if (names.includes(msg.section)) {
          section = sections[names.indexOf(msg.section)];
        } else {
          const projectId = this.getAttribute("project-id");
          section = this._createNewSection(msg.section, projectId, []);
          this._updateSectionNames();
        }
        updateSection(section, msg, null);
      }
    });

    this._progress.addEventListener("algorithmProgress", evt => {
      const msg = evt.detail.message;
      if (msg.project_id != this.getAttribute("project-id"))
      {
        return;
      }
      const sections = [...this._shadow.querySelectorAll("media-section")];
      const names = sections.map(elem => elem._sectionName);
      const mediaIds = msg.media_ids.split(",");
      const msgSections = msg.sections.split(",");
      for (let idx = 0; idx < mediaIds.length; idx++) {
        const section = sections[names.indexOf(msgSections[idx])];
        const mediaId = Number(mediaIds[idx]);
        const media = section.hasMedia(mediaId);
        media.uid = msg.uid;
        if ("progress" in msg) {
          media.progress = msg.progress;
        } else {
          delete media.progress;
        }
        if ("message" in msg) {
          media.message = msg.message;
        } else {
          delete media.message;
        }
        media.state = msg.state;
        updateSection(section, media, mediaId);
      }
    });

    this._newSection.addEventListener("addingfiles", this._addingFilesCallback.bind(this));
    this._newSection.addEventListener("filesadded", this._filesAddedCallback.bind(this));
    this._newSection.addEventListener("allset", this._allSetCallback.bind(this));

    this._uploadButton.addEventListener("addingfiles", this._addingFilesCallback.bind(this));
    this._uploadButton.addEventListener("filesadded", this._filesAddedCallback.bind(this));
    this._uploadButton.addEventListener("allset", this._allSetCallback.bind(this));

    this._loaded = 0;
    this._needScroll = true;
    this._sections = {};

    this._lastQuery = (this._search.value == "" ? null : this._search.value);
    this._search.addEventListener('filterProject',(evt) => {
      const query = evt.detail.query;
      if (query.length >= 3 && query != this._lastQuery)
      {
        this._lastQuery = query;
        document.body.style.cursor = "progress";
        this._updateMedia(query).then(() => {
          this._updateSections();
          document.body.style.cursor = null;
        });
      }
      if (query == "")
      {
        this._lastQuery = null;
        this._updateMedia().then(() => {
          this._updateSections();
          document.body.style.cursor = null;
        });
      }
    });
  }

  static get observedAttributes() {
    return ["project-id", "token"].concat(TatorPage.observedAttributes);
  }

  _updateMedia(projectFilter) {
    const project_id = this.getAttribute('project-id');
    // Get info about the project.
    fetch("/rest/Project/" + project_id, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": getCookie("csrftoken"),
        "Accept": "application/json",
        "Content-Type": "application/json"
      }
    })
    .then(response => response.json())
    .then(data => {
      this._projectText.nodeValue = data.name;
      this._search.setAttribute("project-name", data.name);
      this._description.setAttribute("text", data.summary);
      this._collaborators.usernames = data.usernames;
      this._search.autocomplete = data.filter_autocomplete;
    })
    .catch(err => console.log("Failed to retrieve project data: " + err));

    // Define a function for retrieving project data.
    const getProjectData = endpoint => {
      const url = "/rest/" + endpoint + "/" + project_id;
      return fetch(url, {
        method: "GET",
        credentials: "same-origin",
        headers: {
          "X-CSRFToken": getCookie("csrftoken"),
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
      }).then(response => response.json())
    }

    // Attempt to use the last query if present
    if (projectFilter == undefined)
    {
      projectFilter = this._lastQuery;
    }
    // Get media ids by attribute.
    var url = "/rest/EntityMedias/" + project_id +
        "?operation=attribute_ids::tator_user_sections";
    if (projectFilter)
    {
      url += "&search=" + projectFilter;
    }
    const mediaPromise = fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": getCookie("csrftoken"),
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
    }).then(response => response.json());

    return new Promise((resolve) => {
    // Get project data then create sections.
      Promise.all([
        //getProjectData("EntityMedias"),
        mediaPromise,
        getProjectData("Algorithms"),
      ])
        .then(([mediaIds, algorithms]) => {

          this._mediaIds = mediaIds;
          this._algorithms = algorithms;
          this._algorithmButton.algorithms = algorithms;
          this._makeSections("tator_user_sections", project_id);
          resolve();
        });
    });
  }

  attributeChangedCallback(name, oldValue, newValue) {
    TatorPage.prototype.attributeChangedCallback.call(this, name, oldValue, newValue);
    switch (name) {
      case "username":
        this._uploadButton.setAttribute("username", newValue);
        this._newSection.setAttribute("username", newValue);
        break;
      case "project-id":
        this._uploadButton.setAttribute("project-id", newValue);
        this._algorithmButton.setAttribute("project-id", newValue);
        this._newSection.setAttribute("project-id", newValue);
        this._updateMedia();
        break;
      case "token":
        this._uploadButton.setAttribute("token", newValue);
        this._newSection.setAttribute("token", newValue);
        break;
    }
  }

  _makeSections(key, projectId) {

    // Create the media sections.
    const names = Object.keys(this._mediaIds);
    for (const name of names) {
      this._createNewSection(name, projectId, this._mediaIds[name]);
    }
    this._updateSectionNames();
  }

  _updateSections() {
    // Update media sections
    const names = Object.keys(this._sections);
    for (const name of names) {
      var update=[]
      if (name in this._mediaIds)
      {
        update = this._mediaIds[name];
      }
      this._sections[name].mediaIds = update;
      if (this._lastQuery)
      {
        this._sections[name].overview.updateForSearch(update);
      }
      else
      {
        this._sections[name].overview.updateForAllSoft();
      }
    }
    this._updateSectionNames();
  }

  _createNewSection(sectionName, projectId, mediaIds) {
    if (sectionName in this._sections)
    {
      return;
    }
    const newSection = document.createElement("media-section");
    this._sections[sectionName] = newSection;
    newSection.setAttribute("project-id", projectId);
    newSection.setAttribute("name", sectionName);
    newSection.setAttribute("id", sectionName);
    newSection.setAttribute("username", this._uploadButton.getAttribute("username"));
    newSection.setAttribute("token", this._uploadButton.getAttribute("token"));
    newSection.mediaIds = mediaIds;
    newSection.algorithms = this._algorithms;
    newSection.addEventListener("addingfiles", this._addingFilesCallback.bind(this));
    newSection.addEventListener("filesadded", this._filesAddedCallback.bind(this));
    newSection.addEventListener("allset", this._allSetCallback.bind(this));
    newSection.addEventListener("remove", this._removeCallback);
    newSection.addEventListener("deleteFile", this._deleteFileCallback);
    newSection.addEventListener("newAlgorithm", this._newAlgorithmCallback);
    newSection.addEventListener("moveFileToNew", evt => {
      const name = this._newSectionName();
      const section = this._createNewSection(name, projectId, []);
      this._updateSectionNames();
      this._moveFile(evt.detail.mediaId, evt.target, name);
    });
    newSection.addEventListener("moveFile", evt => {
      this._moveFile(evt.detail.mediaId, evt.target, evt.detail.to);
    });
    newSection.addEventListener("newName", () => {
      this._updateSectionNames();
    });
    newSection.addEventListener("cancelUpload", evt => {
      window._serviceWorker.postMessage({
        "command": "cancelUpload",
        "uid": evt.detail.uid,
      });
    });
    newSection.addEventListener("sectionLoaded", this._scrollToHash.bind(this));
    this._projects.insertBefore(newSection, this._projects.firstChild.nextSibling);
    return newSection;
  }

  _updateSectionNames() {
    const sections = [...this._shadow.querySelectorAll("media-section")];
    const names = sections.map(elem => elem._sectionName);
    for (const section of sections) {
      section.sections = names;
    }
  }

  _newSectionName() {
    const sections = [...this._shadow.querySelectorAll("media-section")];
    const sectionNames = sections.map(elem => elem._sectionName);
    let newName = "Unnamed Section";
    let increment = 1;
    while (sectionNames.includes(newName)) {
      newName = "Unnamed Section (" + increment + ")";
      increment++;
    }
    return newName;
  }

  _moveFile(mediaId, fromSection, toSectionName) {
    const sectionQuery = "media-section[name='" + toSectionName + "']"
    const toSection = this._shadow.querySelector(sectionQuery);
    const media = fromSection.removeMedia(mediaId);
    toSection.addMedia(media);
    fetch("/rest/EntityMedia/" + mediaId, {
      method: "PATCH",
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": getCookie("csrftoken"),
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        "attributes": {"tator_user_sections": toSectionName}
      }),
    });
  }

  async _scrollToHash() {
    if (this._needScroll) {
      this._loaded += 1;
      const sections = [...this._shadow.querySelectorAll("media-section")];
      if (this._loaded >= sections.length) {
        const hashName = decodeURI(window.location.hash.slice(1));
        for (const section of sections) {
          if (section.getAttribute("name") == hashName) {
            await new Promise(resolve => setTimeout(resolve, 100));
            section.scrollIntoView(true);
            window.scrollBy(0, -62); // adjust for header height
            this._needScroll = false;
          }
        }
      }
    }
  }

  _addingFilesCallback(evt) {
    this._progress.notify("Adding files...", false);
    this._leaveConfirmOk = true;
  };

  _filesAddedCallback(evt) {
    const numFiles = evt.detail.numStarted;
    this._progress.notify("Preparing " + numFiles + " files for upload...", false);
    this._newSection.close();
    this._leaveConfirmOk = true;
  };

  _allSetCallback() {
    this._progress.notify("Upload started!", true);
    this._leaveConfirmOk = false;
  }

}

customElements.define("project-detail", ProjectDetail);
