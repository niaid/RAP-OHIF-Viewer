import React, { useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { StudyBrowser } from '@ohif/ui';
import { dicomMetadataStore, useViewModel } from '@ohif/core';

function PanelStudyBrowser({ getDataSources, commandsManager }) {
  console.warn('StudyBrowserPanel rerender');
  const [activeTabName, setActiveTabName] = useState('primary');
  const [studyData, setStudyData] = useState([]);
  const [thumbnailImageSrcMap, setThumbnailImageSrcMap] = useState(new Map());
  const updateThumbnailMap = (k, v) => {
    setThumbnailImageSrcMap(thumbnailImageSrcMap.set(k, v));
  };

  const viewModel = useViewModel();
  const dataSource = getDataSources('dicomweb')[0];
  const viewportData = []; //useViewportGrid();
  const seriesTracking = {}; //useSeriesTracking();

  // This effect
  useEffect(() => {
    if (!viewModel.displaySetInstanceUIDs.length) {
      return;
    }

    let isSubscribed = true;

    const command = commandsManager.getCommand(
      'getCornerstoneLibraries',
      'VIEWER'
    );

    if (!command) {
      throw new Error('Required command not found');
    }

    const { cornerstone, cornerstoneTools } = command.commandFn();

    viewModel.displaySetInstanceUIDs.forEach(uid => {
      const imageIds = dataSource.getImageIdsForDisplaySet(uid);
      const imageId = imageIds[Math.floor(imageIds.length / 2)];

      getImageSrc(imageId, { cornerstone }).then(imageSrc => {
        if (isSubscribed) {
          updateThumbnailMap(uid, imageSrc);
        }
      });
    });

    const displaySets = viewModel.displaySetInstanceUIDs.map(
      displaySetManager.getDisplaySetByUID
    );

    const aDisplaySet = displaySets[0];
    const firstStudy = dicomMetadataStore.getStudy(
      aDisplaySet.StudyInstanceUID
    );
    const firstInstance = firstStudy.series[0].instances[0];
    const PatientID = firstInstance.PatientID;

    dataSource.query.studies.search({ patientId: PatientID }).then(results => {
      const studies = results.map(study => {
        // TODO: Why does the data source return in this format?
        return {
          AccessionNumber: study.accession,
          StudyDate: study.date,
          StudyDescription: study.description,
          NumInstances: study.instances,
          ModalitiesInStudy: study.modalities,
          PatientID: study.mrn,
          PatientName: study.patientName,
          StudyInstanceUID: study.studyInstanceUid,
          StudyTime: study.time,
        };
      });

      const studiesFromInstanceData = {};
      displaySets.forEach(ds => {
        const displaySet = {
          displaySetInstanceUID: ds.displaySetInstanceUID,
          description: ds.SeriesDescription,
          seriesNumber: ds.SeriesNumber,
          modality: ds.Modality,
          date: ds.SeriesDate,
          numInstances: ds.numImageFrames,
        };

        const displaySetViewportData = viewportData.find(
          a => a.displaySetInstanceUID === ds.displaySetInstanceUID
        );

        if (displaySetViewportData) {
          displaySet.viewportIdentificator = displaySetViewportData.identifier;
        }

        const trackingInfo = seriesTracking[ds.SeriesInstanceUID];
        if (trackingInfo) {
          displaySet.isTracked = trackingInfo.isTracked;
        } else {
          displaySet.isTracked = false;
        }

        displaySet.componentType = 'thumbnailTracked';

        if (
          !Object.keys(studiesFromInstanceData).includes(ds.StudyInstanceUID)
        ) {
          const study = dicomMetadataStore.getStudy(ds.StudyInstanceUID);
          const anInstance = study.series[0].instances[0];

          studiesFromInstanceData[ds.StudyInstanceUID] = {
            date: anInstance.StudyDate, // TODO: Format this date to DD-MMM-YYYY
            description: anInstance.StudyDescription,
            displaySets: [],
            numInstances: 0,
            modalitiesSet: new Set(),
          };
        }

        studiesFromInstanceData[ds.StudyInstanceUID].displaySets.push(
          displaySet
        );
        studiesFromInstanceData[ds.StudyInstanceUID].numInstances +=
          displaySet.numInstances;

        studiesFromInstanceData[ds.StudyInstanceUID].modalitiesSet.add(
          displaySet.modality
        );

        const modalitiesSet =
          studiesFromInstanceData[ds.StudyInstanceUID].modalitiesSet;
        studiesFromInstanceData[ds.StudyInstanceUID].modalities = Array.from(
          modalitiesSet
        ).join(', ');
      });

      // QIDO for all by MRN
      const allStudies = studies.map(studyLevelData => {
        const studyFromInstanceData =
          studiesFromInstanceData[studyLevelData.StudyInstanceUID];

        if (!studyFromInstanceData) {
          return {
            studyInstanceUid: studyLevelData.StudyInstanceUID,
            date: studyLevelData.StudyDate,
            description: studyLevelData.StudyDescription,
            modalities: studyLevelData.ModalitiesInStudy,
            numInstances: studyLevelData.NumInstances,
            displaySets: [],
          };
        }

        return {
          studyInstanceUid: studyLevelData.StudyInstanceUID,
          date: studyLevelData.StudyDate || studyFromInstanceData.date,
          description:
            studyLevelData.StudyDescription ||
            studyFromInstanceData.description,
          modalities:
            studyFromInstanceData.modalities ||
            studyLevelData.ModalitiesInStudy,
          numInstances:
            studyLevelData.NumInstances || studyFromInstanceData.numInstances,
          displaySets: studyFromInstanceData.displaySets,
        };
      });

      if (isSubscribed) {
        setStudyData(allStudies);
      }
    });

    return () => (isSubscribed = false);
  }, [viewModel.displaySetInstanceUIDs, thumbnailImageSrcMap, setStudyData]);

  studyData.forEach(study => {
    study.displaySets.forEach(ds => {
      ds.imageSrc = thumbnailImageSrcMap.get(ds.displaySetInstanceUID);
    });
  });

  const primary = studyData.find(study => {
    return true; // TODO: check study.StudyInstanceUID matches queryparam?
  });

  // TODO: Filter allStudies to dates within one year of current date
  const recentStudies = studyData.filter(study => {
    return true; // TODO: check study.date
  });

  const tabs = [
    {
      name: 'primary',
      label: 'Primary',
      studies: primary ? [primary] : [],
    },
    {
      name: 'recent',
      label: 'Recent',
      studies: recentStudies,
    },
    {
      name: 'all',
      label: 'All',
      studies: studyData,
    },
  ];

  function onClickStudy(StudyInstanceUID) {
    const study = studyData.find(a => a.studyInstanceUid === StudyInstanceUID);
    if (study && study.displaySets && study.displaySets.length) {
      return;
    }

    console.warn(`onClickStudy: ${StudyInstanceUID}`);
    // TODO: This is weird, why can't the data source just be used as
    // as function that doesn't expect a query string?
    const queryParams = `?StudyInstanceUIDs=${StudyInstanceUID}`;

    dataSource.retrieve.series.metadata(
      queryParams,
      displaySetManager.makeDisplaySets
    );
  }

  const memoOnClickStudy = useCallback(
    StudyInstanceUID => {
      onClickStudy(StudyInstanceUID);
    },
    [studyData]
  );

  return (
    <StudyBrowser
      activeTabName={activeTabName}
      tabs={tabs}
      onClickStudy={memoOnClickStudy}
      onSetTabActive={setActiveTabName}
    />
  );
}

function WrappedPanelStudyBrowser({ commandsManager, extensionManager }) {
  return (
    <PanelStudyBrowser
      getDataSources={extensionManager.getDataSources}
      commandsManager={commandsManager}
    />
  );
}

WrappedPanelStudyBrowser.propTypes = {
  commandsManager: PropTypes.object.isRequired,
  extensionManager: PropTypes.object.isRequired,
};

export { WrappedPanelStudyBrowser };
